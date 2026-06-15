import express from 'express';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';
import { readFile, writeFile } from '../tools/filesystem';
import { executeCommand } from '../tools/terminal';
import { gitStatus, gitCommit } from '../tools/git';
import { searchWorkspace } from '../tools/search';

const app = express();
app.use(cors());
app.use(express.json());

// Basic session storage in memory
const sessions: Record<string, any> = {};

// POST /v1/session/start
app.post('/v1/session/start', (req, res) => {
    const sessionId = uuidv4();
    sessions[sessionId] = { workspace: req.body.workspace, profile: req.body.profile || 'ILMA' };
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
app.post('/v1/chat/completions', (req, res) => {
    if (req.body.stream) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "Hello from Hermes Server!" } }] })}\n\n`);
        setTimeout(() => {
            res.write(`data: [DONE]\n\n`);
            res.end();
        }, 1000);
    } else {
        res.json({ choices: [{ message: { content: "Hello from Hermes Server!" } }] });
    }
});

// POST /v1/agent/run (SSE)
app.post('/v1/agent/run', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    
    // Simulate planning -> diff -> execution -> done
    res.write(`event: plan\ndata: ${JSON.stringify({ steps: [{ id: "1", action: "read_file", target: "sample.txt" }] })}\n\n`);
    
    setTimeout(() => {
        res.write(`event: done\ndata: ${JSON.stringify({ summary: "Task completed", files_modified: [] })}\n\n`);
        res.end();
    }, 2000);
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
        // Return diff and don't write
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
