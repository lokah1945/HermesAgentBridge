import express from 'express';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';
import { readFile, writeFile } from '../tools/filesystem';
import { executeCommand } from '../tools/terminal';
import { gitStatus, gitCommit } from '../tools/git';
import { searchWorkspace } from '../tools/search';
import { createPlan } from '../runtime/planner';
import { executeStep } from '../runtime/executor';
import { chat, chatStream } from './adapter/llm';

const app = express();
app.use(cors());
app.use(express.json());

// Basic session storage in memory
const sessions: Record<string, any> = {};

// Active executions cache
const activeExecutions: Record<string, {
    resolve: (action: 'approve' | 'reject') => void;
    pendingResult?: any;
    pendingStep?: any;
}> = {};

// POST /v1/session/start
app.post('/v1/session/start', (req, res) => {
    const sessionId = uuidv4();
    sessions[sessionId] = { workspace: req.body.workspace, history: [], profile: req.body.profile || 'ILMA' };
    res.json({ session_id: sessionId });
});

// POST /v1/session/end
app.post('/v1/session/end', (req, res) => {
    delete sessions[req.body.session_id];
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
            res.status(500).json({ error: err.message });
        }
    }
});

// POST /v1/agent/run (SSE)
app.post('/v1/agent/run', async (req, res) => {
    const { session_id, task, workspace, mode } = req.body;
    
    if (!session_id || !task || !workspace || !workspace.root) {
        res.status(400).json({ error: "Missing required fields (session_id, task, workspace.root)" });
        return;
    }

    const workspaceRoot = workspace.root;

    // Set up SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // Build context
    const gitStatusRes = await gitStatus(workspaceRoot);
    const context = {
        root: workspaceRoot,
        files: [],
        symbols: [],
        dependencies: { imports: [], exports: [] },
        git_status: gitStatusRes.success ? gitStatusRes.output : "Error fetching git status"
    };

    // Initialize session history if not present
    if (!sessions[session_id]) {
        sessions[session_id] = { workspace, history: [], profile: 'ILMA' };
    }
    const history = sessions[session_id].history || [];

    try {
        // Create plan
        const plan = await createPlan(task, context, session_id);
        
        // Stream plan event
        res.write(`event: plan\ndata: ${JSON.stringify(plan)}\n\n`);

        const modifiedFiles: string[] = [];

        // For each step in the plan
        for (const step of plan.steps) {
            const isAuto = step.mode === 'auto' || mode === 'auto';

            if (isAuto) {
                // Execute directly
                const result = await executeStep(step, context, history);
                if (result.status === 'success') {
                    if (step.action === 'write_file' && result.diff) {
                        modifiedFiles.push(result.diff.file);
                    }
                    res.write(`event: result\ndata: ${JSON.stringify(result)}\n\n`);
                    history.push({ role: 'user', content: `Executed step ${step.id}: ${step.description}` });
                    history.push({ role: 'assistant', content: result.output || "Success" });
                } else {
                    res.write(`event: error\ndata: ${JSON.stringify({ error: result.error || "Step execution failed" })}\n\n`);
                    res.end();
                    return;
                }
            } else {
                // Review mode: generate diff (or draft) and await approval
                const result = await executeStep(step, context, history);
                
                if (result.status === 'error') {
                    res.write(`event: error\ndata: ${JSON.stringify({ error: result.error || "Step preparation failed" })}\n\n`);
                    res.end();
                    return;
                }

                // Stream diff event: SSE { event: "diff", data: { step, before: result.diff.before, after: result.diff.after } }
                if (step.action === 'write_file' && result.diff) {
                    res.write(`event: diff\ndata: ${JSON.stringify({ step, before: result.diff.before, after: result.diff.after })}\n\n`);
                } else if (step.action === 'run_command') {
                    res.write(`event: diff\ndata: ${JSON.stringify({ step, command: step.target })}\n\n`);
                }

                // Stream awaiting_approval event
                res.write(`event: awaiting_approval\ndata: ${JSON.stringify({ session_id, step_id: step.id })}\n\n`);

                // PAUSE: Wait for approval or rejection
                const approvalPromise = new Promise<'approve' | 'reject'>((resolve) => {
                    activeExecutions[session_id] = {
                        resolve,
                        pendingResult: result,
                        pendingStep: step
                    };
                });

                const action = await approvalPromise;
                delete activeExecutions[session_id];

                if (action === 'approve') {
                    if (step.action === 'write_file' && result.diff) {
                        const writeRes = writeFile(workspaceRoot, step.target, result.diff.after);
                        if (writeRes.success) {
                            modifiedFiles.push(result.diff.file);
                            res.write(`event: result\ndata: ${JSON.stringify({ stepId: step.id, status: 'success', output: 'File written successfully' })}\n\n`);
                        } else {
                            res.write(`event: error\ndata: ${JSON.stringify({ error: writeRes.error || "Failed to write file" })}\n\n`);
                            res.end();
                            return;
                        }
                    } else if (step.action === 'run_command') {
                        const execResult = await executeCommand(workspaceRoot, step.target);
                        if (execResult.success) {
                            res.write(`event: result\ndata: ${JSON.stringify({ stepId: step.id, status: 'success', output: execResult.output })}\n\n`);
                        } else {
                            res.write(`event: error\ndata: ${JSON.stringify({ error: execResult.output || "Failed to execute command" })}\n\n`);
                            res.end();
                            return;
                        }
                    } else {
                        res.write(`event: result\ndata: ${JSON.stringify(result)}\n\n`);
                    }
                    history.push({ role: 'user', content: `Executed step ${step.id}: ${step.description}` });
                    history.push({ role: 'assistant', content: result.output || "Success" });
                } else {
                    res.write(`event: result\ndata: ${JSON.stringify({ stepId: step.id, status: 'error', error: 'User rejected step' })}\n\n`);
                }
            }
        }

        // Stream done event
        res.write(`event: done\ndata: ${JSON.stringify({ summary: "Task completed", files_modified: modifiedFiles })}\n\n`);
        res.end();

    } catch (e: any) {
        res.write(`event: error\ndata: ${JSON.stringify({ error: e.message || "Failed to create or run plan" })}\n\n`);
        res.end();
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
        res.status(400).json({ error: `No active review step found for session ${sessionId} and step ${stepId}` });
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
        res.status(400).json({ error: `No active review step found for session ${sessionId} and step ${stepId}` });
    }
});

// POST /v1/files/read
app.post('/v1/files/read', (req, res) => {
    const { path: targetPath, workspace } = req.body;
    const result = readFile(workspace, targetPath);
    if (result.success) {
        res.json({ content: result.content });
    } else {
        res.status(400).json({ error: result.error });
    }
});

// POST /v1/files/write
app.post('/v1/files/write', (req, res) => {
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
app.post('/v1/tools/execute', async (req, res) => {
    const { tool, action, params, session_id } = req.body;
    const workspace = sessions[session_id]?.workspace || process.cwd();
    
    if (tool === 'terminal') {
        const result = await executeCommand(workspace, params.command);
        res.json(result);
    } else if (tool === 'git') {
        if (action === 'status') {
            const result = await gitStatus(workspace);
            res.json(result);
        } else if (action === 'commit') {
            const result = await gitCommit(workspace, params.message);
            res.json(result);
        } else {
            res.status(400).json({ error: 'Git action not supported' });
        }
    } else if (tool === 'search') {
        const result = await searchWorkspace(workspace, params.query);
        res.json(result);
    } else {
        res.status(400).json({ error: 'Tool not supported' });
    }
});

// POST /v1/workspace/context
app.post('/v1/workspace/context', async (req, res) => {
    const workspace = req.body.workspace || process.cwd();
    const gitStatusRes = await gitStatus(workspace);
    res.json({
        files: [],
        symbols: [],
        dependencies: { imports: [], exports: [] },
        git_status: gitStatusRes.success ? gitStatusRes.output : "Error fetching git status"
    });
});

// POST /v1/responses
app.post('/v1/responses', (req, res) => {
    res.json({ success: true });
});

// Load config and start server
const configPath = path.join(__dirname, '../config/hermes.config.json');
let host = '0.0.0.0';
let port = 3000;

try {
    if (fs.existsSync(configPath)) {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        if (config.server) {
            host = config.server.host || host;
            port = config.server.port || port;
        }
    }
} catch (e) {
    console.error("Failed to load config:", e);
}

app.listen(port, host, () => {
    console.log(`Hermes Server running at http://${host}:${port}`);
});
