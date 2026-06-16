import express from 'express';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';
import { readFile, writeFile } from '../tools/filesystem';
import { executeCommand } from '../tools/terminal';
import { gitStatus, gitCommit, gitDiff } from '../tools/git';
import { searchWorkspace } from '../tools/search';
import { createPlan, revisePlanForError } from '../runtime/planner';
import { executeStep } from '../runtime/executor';
import { chat, chatStream } from './adapter/llm';
import { saveSession, getSession, deleteSession } from './session-store';
import { requireFields } from './middleware/validate';

const app = express();
app.use(cors());
app.use(express.json());

// Active executions cache
const activeExecutions: Record<string, {
    resolve: (action: 'approve' | 'reject') => void;
    pendingStep?: any;
}> = {};

// SSE connections map
const sseConnections: Record<string, express.Response> = {};

function sendSSE(sessionId: string, event: string, data: any) {
    const res = sseConnections[sessionId];
    if (res) {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    }
}

// GET /v1/session/:sessionId/stream
app.get('/v1/session/:sessionId/stream', (req, res) => {
    const { sessionId } = req.params;
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    sseConnections[sessionId] = res;
    console.log(`[SSE] Client connected to session stream: ${sessionId}`);

    // If session has a pending step when connecting, emit awaiting_approval immediately so client UI syncs
    const session = getSession(sessionId);
    if (session && session.pendingStep) {
        // Delay slightly to let EventSource mount listeners
        setTimeout(() => {
            sendSSE(sessionId, 'awaiting_approval', { session_id: sessionId, step_id: session.pendingStep.stepId });
        }, 500);
    }

    req.on('close', () => {
        if (sseConnections[sessionId] === res) {
            delete sseConnections[sessionId];
        }
        console.log(`[SSE] Client disconnected from session stream: ${sessionId}`);
    });
});

// POST /v1/session/start
app.post('/v1/session/start', (req, res) => {
    const sessionId = uuidv4();
    const workspace = req.body.workspace || process.cwd();
    const sessionData = {
        id: sessionId,
        workspace,
        profile: req.body.profile || 'ILMA',
        history: [],
        createdAt: Date.now(),
        updatedAt: Date.now()
    };
    saveSession(sessionId, sessionData);
    res.json({ session_id: sessionId });
});

// POST /v1/session/end
app.post('/v1/session/end', requireFields('session_id'), (req, res) => {
    deleteSession(req.body.session_id);
    res.json({ success: true });
});

// GET /v1/models
app.get('/v1/models', (req, res) => {
    res.json({ data: [{ id: "hermes-ilma", object: "model" }] });
});

// POST /v1/chat/completions
app.post('/v1/chat/completions', async (req, res) => {
    const { messages, stream } = req.body;
    
    if (!messages || !Array.isArray(messages)) {
        res.status(400).json({ error: "Messages array is required" });
        return;
    }

    if (stream) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        
        await chatStream({
            messages,
            onChunk: (delta) => {
                res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: delta } }] })}\n\n`);
            },
            onDone: () => {
                res.write('data: [DONE]\n\n');
                res.end();
            },
            onError: (err) => {
                res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
                res.end();
            }
        });
    } else {
        try {
            const content = await chat(messages);
            res.json({ choices: [{ message: { role: 'assistant', content } }] });
        } catch (err: any) {
            const status = err.message.includes('LLM_UNAVAILABLE') ? 503 : 500;
            res.status(status).json({ 
                error: err.message,
                hint: err.message.includes('LLM_UNAVAILABLE') ? "Jalankan: ollama serve" : undefined 
            });
        }
    }
});

async function handleStepFailure(sessionId: string, failedStep: any, errorMsg: string, context: any): Promise<boolean> {
    const session = getSession(sessionId);
    if (!session) return false;
    
    session.retryCount = session.retryCount || 0;
    if (session.retryCount >= 2) {
        sendSSE(sessionId, 'error', { error: `Max retries reached. Original error: ${errorMsg}` });
        return false;
    }
    
    session.retryCount++;
    sendSSE(sessionId, 'info', { message: `Step ${failedStep.id} failed. Retrying (Attempt ${session.retryCount}/2) via Self-Correction Loop...` });
    
    try {
        const revisedPlan = await revisePlanForError(failedStep, errorMsg, context, session.history);
        const currentIdx = session.currentStepIndex || 0;
        const remainingSteps = session.plan.steps.slice(currentIdx + 1);
        
        session.plan.steps = [
            ...session.plan.steps.slice(0, currentIdx),
            ...revisedPlan.steps,
            ...remainingSteps
        ];
        
        session.currentStepIndex = currentIdx;
        session.pendingStep = undefined;
        saveSession(sessionId, session);
        
        sendSSE(sessionId, 'plan', session.plan);
        runAgentLoop(sessionId);
        return true;
    } catch (e: any) {
        sendSSE(sessionId, 'error', { error: `Self-correction failed: ${e.message}` });
        return false;
    }
}

async function runAgentLoop(sessionId: string) {
    const session = getSession(sessionId);
    if (!session || !session.plan || session.currentStepIndex === undefined) {
        return;
    }

    const workspaceRoot = session.workspace?.root || session.workspace || process.cwd();
    const gitStatusRes = await gitStatus(workspaceRoot);
    const gitDiffRes = await gitDiff(workspaceRoot);
    const context = {
        root: workspaceRoot,
        files: [],
        symbols: [],
        dependencies: { imports: [], exports: [] },
        git_status: gitStatusRes.success ? gitStatusRes.output : "Error fetching git status",
        git_diff: gitDiffRes.success ? gitDiffRes.output : "Error fetching git diff"
    };

    const steps = session.plan.steps;
    const modifiedFiles: string[] = [];

    for (let i = session.currentStepIndex; i < steps.length; i++) {
        const currentSession = getSession(sessionId);
        if (!currentSession) break;
        currentSession.currentStepIndex = i;
        saveSession(sessionId, currentSession);

        const step = steps[i];
        
        try {
            // Check if auto mode
            const isAuto = step.mode === 'auto' || currentSession.mode === 'auto';

            if (isAuto) {
                const result = await executeStep(step, context, currentSession.history);
                if (result.status === 'success') {
                    if (step.action === 'write_file' && result.diff) {
                        modifiedFiles.push(result.diff.file);
                    }
                    sendSSE(sessionId, 'result', result);
                    currentSession.history.push({ role: 'user', content: `Executed step ${step.id}: ${step.description}` });
                    currentSession.history.push({ role: 'assistant', content: result.output || "Success" });
                    saveSession(sessionId, currentSession);
                } else {
                    const errorMsg = result.error || "Step execution failed";
                    const handled = await handleStepFailure(sessionId, step, errorMsg, context);
                    if (handled) return;
                    sendSSE(sessionId, 'error', { error: errorMsg });
                    return;
                }
            } else {
                // Review mode
                const result = await executeStep(step, context, currentSession.history);
                if (result.status === 'error') {
                    const errorMsg = result.error || "Step preparation failed";
                    const handled = await handleStepFailure(sessionId, step, errorMsg, context);
                    if (handled) return;
                    sendSSE(sessionId, 'error', { error: errorMsg });
                    return;
                }

                if (step.action === 'write_file' && result.diff) {
                    sendSSE(sessionId, 'diff', {
                        stepId: step.id,
                        file: step.target,
                        unified: result.diff.unified || ""
                    });
                    currentSession.pendingStep = {
                        stepId: step.id,
                        action: step.action,
                        target: step.target,
                        after: result.diff.after
                    };
                    saveSession(sessionId, currentSession);
                } else if (step.action === 'run_command') {
                    sendSSE(sessionId, 'diff', {
                        stepId: step.id,
                        file: step.target,
                        unified: `Command to execute: ${step.target}`,
                        action: 'run_command'
                    });
                    currentSession.pendingStep = {
                        stepId: step.id,
                        action: step.action,
                        target: step.target,
                        after: ''
                    };
                    saveSession(sessionId, currentSession);
                }

                sendSSE(sessionId, 'awaiting_approval', { session_id: sessionId, step_id: step.id, action: step.action });

                const approvalPromise = new Promise<'approve' | 'reject'>((resolve) => {
                    activeExecutions[sessionId] = {
                        resolve,
                        pendingStep: step
                    };
                });

                const action = await approvalPromise;
                delete activeExecutions[sessionId];

                const updatedSession = getSession(sessionId);
                if (!updatedSession) return;

                if (action === 'approve') {
                    if (step.action === 'write_file' && result.diff) {
                        const writeRes = writeFile(workspaceRoot, step.target, result.diff.after);
                        if (writeRes.success) {
                            modifiedFiles.push(result.diff.file);
                            sendSSE(sessionId, 'applied', { file: step.target, stepId: step.id });
                        } else {
                            const errorMsg = writeRes.error || "Failed to write file";
                            const handled = await handleStepFailure(sessionId, step, errorMsg, context);
                            if (handled) return;
                            sendSSE(sessionId, 'error', { error: errorMsg });
                            return;
                        }
                    } else if (step.action === 'run_command') {
                        const execResult = await executeCommand(workspaceRoot, step.target);
                        if (execResult.success) {
                            sendSSE(sessionId, 'result', { stepId: step.id, status: 'success', output: execResult.output });
                        } else {
                            const errorMsg = execResult.output || "Failed to execute command";
                            const handled = await handleStepFailure(sessionId, step, errorMsg, context);
                            if (handled) return;
                            sendSSE(sessionId, 'error', { error: errorMsg });
                            return;
                        }
                    } else {
                        sendSSE(sessionId, 'result', result);
                    }
                    updatedSession.pendingStep = undefined;
                    updatedSession.history.push({ role: 'user', content: `Executed step ${step.id}: ${step.description}` });
                    updatedSession.history.push({ role: 'assistant', content: result.output || "Success" });
                    saveSession(sessionId, updatedSession);
                } else {
                    updatedSession.pendingStep = undefined;
                    saveSession(sessionId, updatedSession);
                    sendSSE(sessionId, 'rejected', { stepId: step.id });
                }
            }
        } catch (e: any) {
            console.error(`[Agent Loop Error] sessionId: ${sessionId}`, e);
            const handled = await handleStepFailure(sessionId, step, e.message || "Failed during step execution", context);
            if (handled) return;
            sendSSE(sessionId, 'error', { error: e.message || "Failed during step execution" });
            return;
        }
    }

    const finalSession = getSession(sessionId);
    if (finalSession) {
        finalSession.currentStepIndex = steps.length;
        finalSession.retryCount = 0;
        saveSession(sessionId, finalSession);
    }
    sendSSE(sessionId, 'done', { summary: "Task completed", files_modified: modifiedFiles });
}

// POST /v1/agent/run
app.post('/v1/agent/run', requireFields('session_id', 'task', 'workspace'), async (req, res) => {
    const { session_id, task, workspace, mode } = req.body;
    const workspaceRoot = workspace.root;

    let session = getSession(session_id);
    if (!session) {
        session = {
            id: session_id,
            workspace,
            profile: 'ILMA',
            history: [],
            createdAt: Date.now(),
            updatedAt: Date.now()
        };
    } else {
        session.workspace = workspace;
    }
    session.mode = mode || 'review';
    saveSession(session_id, session);

    const gitStatusRes = await gitStatus(workspaceRoot);
    const gitDiffRes = await gitDiff(workspaceRoot);
    const context = {
        root: workspaceRoot,
        files: [],
        symbols: [],
        dependencies: { imports: [], exports: [] },
        git_status: gitStatusRes.success ? gitStatusRes.output : "Error fetching git status",
        git_diff: gitDiffRes.success ? gitDiffRes.output : "Error fetching git diff"
    };

    try {
        const plan = await createPlan(task, context, session_id);
        
        session.plan = plan;
        session.currentStepIndex = 0;
        session.pendingStep = undefined;
        saveSession(session_id, session);

        sendSSE(session_id, 'plan', plan);

        // Run agent in background
        runAgentLoop(session_id);

        res.json({ success: true, message: "Agent started" });
    } catch (e: any) {
        console.error(`[Agent Run Route Error] sessionId: ${session_id}`, e);
        sendSSE(session_id, 'error', { error: e.message || "Failed to create plan" });
        const status = e.message.includes('LLM_UNAVAILABLE') ? 503 : 500;
        res.status(status).json({ 
            error: e.message || "Failed to create plan",
            hint: e.message.includes('LLM_UNAVAILABLE') ? "Jalankan: ollama serve" : undefined
        });
    }
});

// POST /v1/agent/approve/:sessionId/:stepId
app.post('/v1/agent/approve/:sessionId/:stepId', (req, res) => {
    const { sessionId, stepId } = req.params;
    const execution = activeExecutions[sessionId];
    if (execution && execution.pendingStep?.id === stepId) {
        execution.resolve('approve');
        res.json({ success: true });
    } else {
        const session = getSession(sessionId);
        if (session && session.pendingStep && session.pendingStep.stepId === stepId) {
            const { target, after } = session.pendingStep;
            const workspaceRoot = session.workspace?.root || session.workspace || process.cwd();
            const writeRes = writeFile(workspaceRoot, target, after);
            if (writeRes.success) {
                session.pendingStep = undefined;
                session.currentStepIndex = (session.currentStepIndex ?? 0) + 1;
                saveSession(sessionId, session);
                
                sendSSE(sessionId, 'applied', { file: target, stepId });
                runAgentLoop(sessionId);
                res.json({ success: true });
            } else {
                res.status(500).json({ error: writeRes.error || "Failed to write file" });
            }
        } else {
            res.status(400).json({ error: `No active review step found for session ${sessionId} and step ${stepId}` });
        }
    }
});

// POST /v1/agent/reject/:sessionId/:stepId
app.post('/v1/agent/reject/:sessionId/:stepId', (req, res) => {
    const { sessionId, stepId } = req.params;
    const execution = activeExecutions[sessionId];
    if (execution && execution.pendingStep?.id === stepId) {
        execution.resolve('reject');
        res.json({ success: true });
    } else {
        const session = getSession(sessionId);
        if (session && session.pendingStep && session.pendingStep.stepId === stepId) {
            session.pendingStep = undefined;
            session.currentStepIndex = (session.currentStepIndex ?? 0) + 1;
            saveSession(sessionId, session);
            
            sendSSE(sessionId, 'rejected', { stepId });
            runAgentLoop(sessionId);
            res.json({ success: true });
        } else {
            res.status(400).json({ error: `No active review step found for session ${sessionId} and step ${stepId}` });
        }
    }
});

// POST /v1/files/read
app.post('/v1/files/read', requireFields('path', 'workspace'), (req, res) => {
    const { path: targetPath, workspace } = req.body;
    const result = readFile(workspace, targetPath);
    if (result.success) {
        res.json({ content: result.content });
    } else {
        res.status(400).json({ error: result.error });
    }
});

// POST /v1/files/write
app.post('/v1/files/write', requireFields('path', 'content', 'workspace'), (req, res) => {
    const { path: targetPath, content, workspace, diff_preview } = req.body;
    
    if (diff_preview) {
        const existing = readFile(workspace, targetPath);
        const before = existing.success ? existing.content : "";
        res.json({ success: true, diff: { before, after: content, file: targetPath } });
        return;
    }

    const result = writeFile(workspace, targetPath, content);
    if (result.success) {
        res.json({ success: true });
    } else {
        res.status(400).json({ error: result.error });
    }
});

// POST /v1/tools/execute
app.post('/v1/tools/execute', requireFields('tool', 'session_id'), async (req, res) => {
    const { tool, action, params, session_id } = req.body;
    const session = getSession(session_id);
    const workspace = session?.workspace?.root || session?.workspace || process.cwd();
    
    if (tool === 'terminal') {
        if (!params || !params.command) {
            res.status(400).json({ error: "Missing parameter 'command'" });
            return;
        }
        const result = await executeCommand(workspace, params.command);
        res.json(result);
    } else if (tool === 'git') {
        if (action === 'status') {
            const result = await gitStatus(workspace);
            res.json(result);
        } else if (action === 'commit') {
            if (!params || !params.message) {
                res.status(400).json({ error: "Missing parameter 'message'" });
                return;
            }
            const result = await gitCommit(workspace, params.message);
            res.json(result);
        } else {
            res.status(400).json({ error: 'Git action not supported' });
        }
    } else if (tool === 'search') {
        if (!params || !params.query) {
            res.status(400).json({ error: "Missing parameter 'query'" });
            return;
        }
        const result = await searchWorkspace(workspace, params.query);
        res.json(result);
    } else {
        res.status(400).json({ error: 'Tool not supported' });
    }
});

// POST /v1/workspace/context
app.post('/v1/workspace/context', (req, res) => {
    const workspace = req.body.workspace || process.cwd();
    gitStatus(workspace).then(gitStatusRes => {
        res.json({
            files: [],
            symbols: [],
            dependencies: { imports: [], exports: [] },
            git_status: gitStatusRes.success ? gitStatusRes.output : "Error fetching git status"
        });
    });
});

// POST /v1/responses
app.post('/v1/responses', (req, res) => {
    res.json({ success: true });
});

// Load config
const configPath = fs.existsSync(path.join(process.cwd(), 'config', 'hermes.config.json'))
    ? path.join(process.cwd(), 'config', 'hermes.config.json')
    : path.join(__dirname, '../config/hermes.config.json');

let host = '0.0.0.0';
let port = 3000;
let profile = 'ILMA';
let llmModel = 'llama3.2';
let llmBaseUrl = 'http://localhost:11434/v1';

try {
    if (fs.existsSync(configPath)) {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        if (config.server) {
            host = config.server.host || host;
            port = config.server.port || port;
        }
        if (config.profile) {
            profile = config.profile;
        }
        if (config.llm) {
            llmModel = config.llm.model || llmModel;
            llmBaseUrl = config.llm.baseUrl || llmBaseUrl;
        }
    }
} catch (e) {
    console.error("Failed to load config:", e);
}

// GET /health
app.get('/health', async (req, res) => {
  const status: any = {
    server: 'ok',
    version: '1.0.0',
    profile: profile,
    uptime: Math.floor(process.uptime()),
    llm: { status: 'unknown', model: llmModel, baseUrl: llmBaseUrl }
  };

  try {
    const r = await fetch(`${llmBaseUrl.replace('/v1','')}/api/tags`);
    status.llm.status = r.ok ? 'ok' : 'degraded';
  } catch {
    status.llm.status = 'unavailable';
  }

  const httpStatus = status.llm.status === 'ok' ? 200 : 207;
  res.status(httpStatus).json(status);
});

const server = app.listen(port, host, () => {
    console.log(`[Hermes] ● Server running at http://${host}:${port}`);
    console.log(`[Hermes] Profile: ${profile} | LLM: ${llmModel}`);
});

const shutdown = (signal: string) => {
  console.log(`\n[Hermes] ${signal} received — shutting down gracefully...`);
  server.close(() => {
    console.log('[Hermes] Server stopped.');
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5000);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
