import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {
    console.log('Hermes Agent Bridge is now active!');

    // Initialize Status Bar Item
    const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.text = '$(circle-filled) Hermes Connected';
    statusBarItem.tooltip = 'Hermes Agent Bridge is active';
    statusBarItem.command = 'hermes.startSession';
    statusBarItem.show();
    context.subscriptions.push(statusBarItem);

    // Register Webview Provider for the Sidebar
    const provider = new HermesChatViewProvider(context.extensionUri);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider('hermes.chatView', provider)
    );

    // Register Commands
    let startSessionDisposable = vscode.commands.registerCommand('hermes.startSession', () => {
        vscode.window.showInformationMessage('Hermes Session Restarted');
        provider.restartSession();
    });

    let configureDisposable = vscode.commands.registerCommand('hermes.configure', () => {
        vscode.commands.executeCommand('workbench.action.openSettings', 'Hermes');
    });

    context.subscriptions.push(startSessionDisposable);
    context.subscriptions.push(configureDisposable);
}

export function deactivate() {}

class HermesChatViewProvider implements vscode.WebviewViewProvider {
    private sessionId: string | null = null;
    private serverUrl = 'http://127.0.0.1:3000';
    private webviewView: vscode.WebviewView | null = null;

    constructor(private readonly _extensionUri: vscode.Uri) {}

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this.webviewView = webviewView;
        
        // Read configuration
        const config = vscode.workspace.getConfiguration('hermes');
        this.serverUrl = config.get<string>('serverUrl') || 'http://127.0.0.1:3000';

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        webviewView.webview.html = this._getHtmlForWebview();
        
        // Listen to configuration changes
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('hermes.serverUrl')) {
                const newUrl = vscode.workspace.getConfiguration('hermes').get<string>('serverUrl') || 'http://127.0.0.1:3000';
                if (newUrl !== this.serverUrl) {
                    this.serverUrl = newUrl;
                    this.restartSession();
                }
            }
        });

        // Start Session
        this.startSession().then(id => {
            this.sessionId = id;
            webviewView.webview.postMessage({ 
                type: 'init', 
                sessionId: id, 
                serverUrl: this.serverUrl 
            });
        }).catch(err => {
            webviewView.webview.postMessage({ 
                type: 'error', 
                value: `Failed to connect to Hermes Server: ${err.message}` 
            });
        });

        webviewView.webview.onDidReceiveMessage(async data => {
            const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '/tmp/test';
            switch (data.type) {
                case 'runAgent':
                    try {
                        const response = await fetch(`${this.serverUrl}/v1/agent/run`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                session_id: this.sessionId,
                                task: data.task,
                                workspace: { root: workspaceRoot },
                                mode: 'review'
                            })
                        });
                        if (!response.ok) {
                            const errData = await response.json() as any;
                            webviewView.webview.postMessage({ 
                                type: 'error', 
                                value: errData.error || 'Failed to start agent.',
                                status: response.status
                            });
                        }
                    } catch (err: any) {
                        webviewView.webview.postMessage({ type: 'error', value: err.message });
                    }
                    break;

                case 'approveStep':
                    try {
                        await fetch(`${this.serverUrl}/v1/agent/approve/${this.sessionId}/${data.stepId}`, {
                            method: 'POST'
                        });
                    } catch (err: any) {
                        webviewView.webview.postMessage({ type: 'error', value: `Approve failed: ${err.message}` });
                    }
                    break;

                case 'rejectStep':
                    try {
                        await fetch(`${this.serverUrl}/v1/agent/reject/${this.sessionId}/${data.stepId}`, {
                            method: 'POST'
                        });
                    } catch (err: any) {
                        webviewView.webview.postMessage({ type: 'error', value: `Reject failed: ${err.message}` });
                    }
                    break;

                case 'restartSession':
                    this.restartSession();
                    break;
            }
        });
    }

    public restartSession() {
        if (!this.webviewView) return;
        this.startSession().then(id => {
            this.sessionId = id;
            this.webviewView?.webview.postMessage({ 
                type: 'init', 
                sessionId: id, 
                serverUrl: this.serverUrl 
            });
        }).catch(err => {
            this.webviewView?.webview.postMessage({ 
                type: 'error', 
                value: `Failed to reconnect: ${err.message}` 
            });
        });
    }

    private async startSession(): Promise<string> {
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '/tmp/test';
        const res = await fetch(`${this.serverUrl}/v1/session/start`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ workspace: workspaceRoot, profile: 'ILMA' })
        });
        if (!res.ok) {
            throw new Error(`Server returned status ${res.status}`);
        }
        const data = await res.json() as any;
        return data.session_id;
    }

    private _getHtmlForWebview() {
        return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Hermes Chat</title>
                <style>
                    :root {
                        --padding: 12px;
                        --primary: #5850ec;
                        --primary-hover: #453e9c;
                        --bg-user: rgba(88, 80, 236, 0.15);
                        --bg-agent: var(--vscode-editor-inactiveSelectionBackground);
                        --border: var(--vscode-panel-border);
                        --text: var(--vscode-foreground);
                        --font-size: 13px;
                    }
                    body {
                        font-family: var(--vscode-font-family, sans-serif);
                        font-size: var(--font-size);
                        color: var(--text);
                        background: var(--vscode-editor-background);
                        padding: 0;
                        margin: 0;
                        display: flex;
                        flex-direction: column;
                        height: 100vh;
                        overflow: hidden;
                    }
                    
                    /* Header Status Bar */
                    .status-header {
                        display: flex;
                        align-items: center;
                        justify-content: space-between;
                        padding: 8px var(--padding);
                        background: var(--vscode-sideBar-background);
                        border-bottom: 1px solid var(--border);
                        font-size: 11px;
                        font-weight: 600;
                    }
                    .status-indicator {
                        display: flex;
                        align-items: center;
                        gap: 6px;
                    }
                    .status-dot {
                        width: 8px;
                        height: 8px;
                        border-radius: 50%;
                        background: #888;
                        transition: background 0.3s ease;
                    }
                    .status-dot.idle { background: #10B981; }
                    .status-dot.thinking { 
                        background: #F59E0B; 
                        animation: pulse 1.2s infinite ease-in-out;
                    }
                    .status-dot.executing { background: #3B82F6; }
                    .status-dot.awaiting { background: #F97316; }
                    .status-dot.error { background: #EF4444; }
                    .status-dot.reconnecting { 
                        background: #F59E0B;
                        animation: pulse 0.8s infinite ease-in-out;
                    }

                    @keyframes pulse {
                        0% { opacity: 0.3; }
                        50% { opacity: 1; }
                        100% { opacity: 0.3; }
                    }

                    /* Chat Area */
                    .chat-container {
                        flex: 1;
                        overflow-y: auto;
                        padding: var(--padding);
                        display: flex;
                        flex-direction: column;
                        gap: 12px;
                    }
                    
                    .message {
                        max-width: 90%;
                        padding: 10px 12px;
                        border-radius: 8px;
                        line-height: 1.4;
                        word-wrap: break-word;
                    }
                    .message.user {
                        align-self: flex-end;
                        background: var(--bg-user);
                        border-bottom-right-radius: 2px;
                    }
                    .message.agent {
                        align-self: flex-start;
                        background: var(--bg-agent);
                        border-bottom-left-radius: 2px;
                    }
                    
                    /* Collapsible Plan Container */
                    .plan-container {
                        margin-top: 8px;
                        border: 1px solid var(--border);
                        border-radius: 6px;
                        background: var(--vscode-sideBar-background);
                        overflow: hidden;
                    }
                    .plan-header {
                        padding: 6px 10px;
                        font-weight: bold;
                        background: rgba(0,0,0,0.1);
                        cursor: pointer;
                        display: flex;
                        justify-content: space-between;
                        font-size: 11px;
                    }
                    .plan-steps {
                        padding: 6px 10px;
                        display: flex;
                        flex-direction: column;
                        gap: 6px;
                    }
                    .plan-step {
                        display: flex;
                        align-items: flex-start;
                        gap: 8px;
                        font-size: 12px;
                    }
                    .step-icon {
                        font-size: 12px;
                        line-height: 1;
                    }
                    .step-desc {
                        flex: 1;
                    }

                    /* Unified Diff Viewer */
                    .diff-container {
                        margin-top: 8px;
                        border: 1px solid var(--border);
                        border-radius: 6px;
                        background: #1e1e1e;
                        font-family: var(--vscode-editor-font-family, monospace);
                        font-size: 11px;
                        overflow-x: auto;
                    }
                    .diff-header {
                        padding: 4px 8px;
                        background: #333;
                        color: #ccc;
                        border-bottom: 1px solid #444;
                        font-weight: bold;
                    }
                    .diff-lines {
                        padding: 6px;
                        white-space: pre;
                    }
                    .diff-line {
                        display: block;
                        padding: 1px 4px;
                    }
                    .diff-line.addition {
                        background-color: rgba(16, 185, 129, 0.2);
                        color: #A7F3D0;
                    }
                    .diff-line.deletion {
                        background-color: rgba(239, 68, 68, 0.2);
                        color: #FCA5A5;
                    }
                    .diff-line.meta {
                        color: #888;
                    }

                    /* Action Buttons Panel */
                    .action-panel {
                        margin-top: 8px;
                        display: flex;
                        gap: 8px;
                    }
                    button {
                        padding: 6px 12px;
                        border: none;
                        border-radius: 4px;
                        cursor: pointer;
                        font-weight: 600;
                        font-size: 12px;
                        flex: 1;
                        color: var(--vscode-button-foreground);
                        background: var(--vscode-button-background);
                    }
                    button:hover {
                        background: var(--vscode-button-hoverBackground);
                    }
                    button.reject {
                        background: var(--vscode-button-secondaryBackground, #4b5563);
                        color: var(--vscode-button-secondaryForeground, #fff);
                    }
                    button.reject:hover {
                        background: rgba(75, 85, 99, 0.8);
                    }

                    /* Input Box Container */
                    .input-container {
                        padding: var(--padding);
                        background: var(--vscode-sideBar-background);
                        border-top: 1px solid var(--border);
                        display: flex;
                        gap: 8px;
                    }
                    textarea {
                        flex: 1;
                        background: var(--vscode-input-background);
                        color: var(--vscode-input-foreground);
                        border: 1px solid var(--vscode-input-border);
                        border-radius: 4px;
                        padding: 8px;
                        resize: none;
                        height: 36px;
                        font-family: inherit;
                        font-size: inherit;
                        outline: none;
                    }
                    textarea::placeholder {
                        color: var(--vscode-input-placeholderForeground);
                    }
                    textarea:focus {
                        border-color: var(--vscode-focusBorder);
                    }
                    .send-btn {
                        width: 36px;
                        height: 36px;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        border-radius: 4px;
                        padding: 0;
                        flex: none;
                    }

                    /* Overlay for Server 503 / Ollama down error */
                    .overlay {
                        position: absolute;
                        top: 0;
                        left: 0;
                        right: 0;
                        bottom: 0;
                        background: rgba(15, 15, 20, 0.95);
                        backdrop-filter: blur(8px);
                        display: flex;
                        flex-direction: column;
                        align-items: center;
                        justify-content: center;
                        z-index: 1000;
                        padding: 24px;
                        text-align: center;
                        color: #f3f4f6;
                        animation: fadeIn 0.3s ease;
                    }

                    @keyframes fadeIn {
                        from { opacity: 0; }
                        to { opacity: 1; }
                    }

                    .overlay-icon {
                        font-size: 48px;
                        margin-bottom: 16px;
                        animation: bounce 2s infinite;
                    }

                    @keyframes bounce {
                        0%, 100% { transform: translateY(0); }
                        50% { transform: translateY(-8px); }
                    }

                    .overlay-title {
                        font-size: 16px;
                        font-weight: bold;
                        color: #ef4444;
                        margin-bottom: 8px;
                    }

                    .overlay-desc {
                        font-size: 13px;
                        color: #9ca3af;
                        margin-bottom: 20px;
                        line-height: 1.5;
                    }

                    .overlay-code {
                        background: #27272a;
                        border: 1px solid #3f3f46;
                        padding: 8px 12px;
                        border-radius: 4px;
                        font-family: monospace;
                        font-size: 12px;
                        color: #a7f3d0;
                        margin-bottom: 24px;
                    }

                    .overlay-btn {
                        background: #ef4444;
                        color: white;
                        border: none;
                        padding: 8px 16px;
                        border-radius: 4px;
                        font-weight: bold;
                        cursor: pointer;
                        font-size: 12px;
                        transition: background 0.2s;
                        width: auto;
                        flex: none;
                    }

                    .overlay-btn:hover {
                        background: #dc2626;
                    }

                    /* Terminal Block CSS */
                    .terminal-container {
                        margin-top: 8px;
                        border: 1px solid var(--border);
                        border-radius: 6px;
                        background: #1e1e1e;
                        overflow: hidden;
                    }
                    .terminal-header {
                        padding: 6px 10px;
                        background: #333;
                        color: #ccc;
                        font-size: 11px;
                        font-weight: bold;
                        display: flex;
                        align-items: center;
                        gap: 6px;
                    }
                    .terminal-body {
                        padding: 10px;
                        font-family: var(--vscode-editor-font-family, monospace);
                        font-size: 12px;
                        color: #f8f8f2;
                        display: flex;
                        align-items: center;
                        gap: 8px;
                    }
                    .terminal-prompt {
                        color: #50fa7b;
                        font-weight: bold;
                    }
                    .terminal-cmd {
                        font-weight: 500;
                        white-space: pre-wrap;
                        word-break: break-all;
                    }

                    /* Terminal Output styling */
                    .terminal-output-container {
                        margin-top: 8px;
                        border: 1px solid var(--border);
                        border-radius: 6px;
                        background: #181818;
                        overflow: hidden;
                    }
                    .terminal-output-header {
                        padding: 4px 8px;
                        background: #252526;
                        color: #858585;
                        font-size: 10px;
                        font-weight: bold;
                        border-bottom: 1px solid var(--border);
                    }
                    .terminal-output-body {
                        padding: 8px;
                        margin: 0;
                        font-family: var(--vscode-editor-font-family, monospace);
                        font-size: 11px;
                        color: #d4d4d4;
                        white-space: pre-wrap;
                        max-height: 200px;
                        overflow-y: auto;
                    }
                </style>
            </head>
            <body>
                <!-- Header Status -->
                <div class="status-header">
                    <div id="connectionStatusText">Connecting...</div>
                    <div class="status-indicator">
                        <div id="statusDot" class="status-dot"></div>
                        <span id="statusLabel">Initializing</span>
                    </div>
                </div>

                <!-- Chat Messages -->
                <div class="chat-container" id="chatContainer">
                    <div class="message agent">
                        <strong>Hermes:</strong> Halo! Ada yang bisa saya bantu hari ini?
                    </div>
                </div>

                <!-- Input Box -->
                <div class="input-container">
                    <textarea id="chatInput" placeholder="Ketik perintah di sini..."></textarea>
                    <button class="send-btn" id="sendBtn">▶</button>
                </div>

                <!-- Ollama Down Overlay -->
                <div id="errorOverlay" class="overlay" style="display: none;">
                    <div class="overlay-icon">⚠️</div>
                    <div class="overlay-title">Ollama is down</div>
                    <div class="overlay-desc">Hermes cannot connect to the Local LLM engine. Please make sure Ollama is running.</div>
                    <div class="overlay-code">ollama serve</div>
                    <button class="overlay-btn" onclick="retryConnection()">Dismiss</button>
                </div>

                <script>
                    const vscode = acquireVsCodeApi();
                    let sessionId = null;
                    let serverUrl = null;
                    let eventSource = null;
                    let reconnectTimer = null;

                    const chatContainer = document.getElementById('chatContainer');
                    const chatInput = document.getElementById('chatInput');
                    const sendBtn = document.getElementById('sendBtn');
                    const connectionStatusText = document.getElementById('connectionStatusText');
                    const statusDot = document.getElementById('statusDot');
                    const statusLabel = document.getElementById('statusLabel');

                    function setStatus(status, labelText) {
                        statusDot.className = 'status-dot ' + status;
                        statusLabel.textContent = labelText || status.charAt(0).toUpperCase() + status.slice(1);
                    }

                    function showOllamaDownOverlay() {
                        document.getElementById('errorOverlay').style.display = 'flex';
                        setStatus('error', 'Ollama Offline');
                    }

                    function retryConnection() {
                        document.getElementById('errorOverlay').style.display = 'none';
                        vscode.postMessage({ type: 'restartSession' });
                    }

                    function connectSSE(sid) {
                        if (eventSource) eventSource.close();
                        
                        console.log('Connecting EventSource to: ' + serverUrl + '/v1/session/' + sid + '/stream');
                        eventSource = new EventSource(serverUrl + '/v1/session/' + sid + '/stream');

                        eventSource.onopen = () => {
                            clearTimeout(reconnectTimer);
                            connectionStatusText.textContent = "CONNECTED";
                            setStatus('idle', 'Ready');
                        };

                        eventSource.onerror = (e) => {
                            console.error('SSE Error:', e);
                            eventSource.close();
                            connectionStatusText.textContent = "DISCONNECTED";
                            setStatus('reconnecting', 'Reconnecting...');
                            reconnectTimer = setTimeout(() => connectSSE(sid), 3000);
                        };

                        eventSource.addEventListener('plan', e => {
                            const plan = JSON.parse(e.data);
                            renderPlan(plan);
                        });

                        eventSource.addEventListener('diff', e => {
                            const diff = JSON.parse(e.data);
                            if (diff.action === 'run_command') {
                                renderTerminalBlock(diff);
                            } else {
                                renderDiff(diff);
                            }
                        });

                        eventSource.addEventListener('awaiting_approval', e => {
                            const data = JSON.parse(e.data);
                            showApprovalButtons(data.step_id, data.action);
                            setStatus('awaiting', 'Awaiting Approval');
                        });

                        eventSource.addEventListener('applied', e => {
                            const data = JSON.parse(e.data);
                            markStepDone(data.stepId);
                            setStatus('idle', 'Ready');
                        });

                        eventSource.addEventListener('rejected', e => {
                            const data = JSON.parse(e.data);
                            markStepRejected(data.stepId);
                            setStatus('idle', 'Ready');
                        });

                        eventSource.addEventListener('result', e => {
                            const res = JSON.parse(e.data);
                            appendResult(res);
                        });

                        eventSource.addEventListener('error', e => {
                            const data = JSON.parse(e.data);
                            if (data.error && (data.error.includes('LLM_UNAVAILABLE') || data.error.includes('Ollama tidak berjalan'))) {
                                showOllamaDownOverlay();
                            } else {
                                showError(data.error);
                                setStatus('error', 'Error occurred');
                            }
                        });

                        eventSource.addEventListener('done', e => {
                            setStatus('idle', 'Ready');
                            appendAgentMessage("<strong>System:</strong> Task completed successfully!");
                        });
                    }

                    window.addEventListener('message', event => {
                        const msg = event.data;
                        if (msg.type === 'init') {
                            sessionId = msg.sessionId;
                            serverUrl = msg.serverUrl;
                            connectSSE(sessionId);
                        } else if (msg.type === 'error') {
                            if (msg.status === 503 || msg.value.includes('LLM_UNAVAILABLE') || msg.value.includes('Ollama tidak berjalan')) {
                                showOllamaDownOverlay();
                            } else {
                                showError(msg.value);
                            }
                        }
                    });

                    // Send Action
                    function handleSend() {
                        const task = chatInput.value.trim();
                        if (!task || !sessionId) return;

                        // Append User message
                        const userMsg = document.createElement('div');
                        userMsg.className = 'message user';
                        userMsg.textContent = task;
                        chatContainer.appendChild(userMsg);
                        chatContainer.scrollTop = chatContainer.scrollHeight;

                        // Post message to extension to start run
                        vscode.postMessage({
                            type: 'runAgent',
                            task: task
                        });

                        chatInput.value = '';
                        setStatus('thinking', 'Thinking...');
                    }

                    sendBtn.addEventListener('click', handleSend);
                    chatInput.addEventListener('keydown', (e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            handleSend();
                        }
                    });

                    function appendAgentMessage(htmlContent) {
                        const msg = document.createElement('div');
                        msg.className = 'message agent';
                        msg.innerHTML = htmlContent;
                        chatContainer.appendChild(msg);
                        chatContainer.scrollTop = chatContainer.scrollHeight;
                        return msg;
                    }

                    // Render Plan
                    function renderPlan(plan) {
                        const html = \`
                            <strong>Goal:</strong> \${plan.goal}
                            <div class="plan-container">
                                <div class="plan-header" onclick="this.nextElementSibling.style.display = this.nextElementSibling.style.display === 'none' ? 'flex' : 'none'">
                                    <span>Plan Details (\${plan.steps.length} steps)</span>
                                    <span>▼</span>
                                </div>
                                <div class="plan-steps" id="stepsList">
                                    \${plan.steps.map(step => \`
                                        <div class="plan-step" id="step-\${step.id}">
                                            <span class="step-icon">⏳</span>
                                            <span class="step-desc"><strong>\${step.action}:</strong> \${step.description}</span>
                                        </div>
                                    \`).join('')}
                                </div>
                            </div>
                        \`;
                        appendAgentMessage(html);
                    }

                    function renderTerminalBlock(diff) {
                        const html = \`
                            <strong>Suggested Terminal Command:</strong>
                            <div class="terminal-container">
                                <div class="terminal-header">
                                    <span class="step-icon">💻</span>
                                    <span>Terminal Command</span>
                                </div>
                                <div class="terminal-body">
                                    <span class="terminal-prompt">$</span>
                                    <span class="terminal-cmd">\${escapeHtml(diff.file)}</span>
                                </div>
                            </div>
                        \`;
                        appendAgentMessage(html);
                    }

                    function renderDiff(diff) {
                        const lines = diff.unified.split('\\n');
                        const lineHtml = lines.map(line => {
                            if (line.startsWith('+') && !line.startsWith('+++')) {
                                return \`<span class="diff-line addition">\${escapeHtml(line)}</span>\`;
                            } else if (line.startsWith('-') && !line.startsWith('---')) {
                                return \`<span class="diff-line deletion">\${escapeHtml(line)}</span>\`;
                            } else if (line.startsWith('@@') || line.startsWith('---') || line.startsWith('+++')) {
                                return \`<span class="diff-line meta">\${escapeHtml(line)}</span>\`;
                            } else {
                                return \`<span class="diff-line">\${escapeHtml(line)}</span>\`;
                            }
                        }).join('');

                        const html = \`
                            <strong>Suggested File Changes:</strong>
                            <div class="diff-container">
                                <div class="diff-header">\${diff.file}</div>
                                <div class="diff-lines">\${lineHtml}</div>
                            </div>
                        \`;
                        appendAgentMessage(html);
                    }

                    function showApprovalButtons(stepId, action) {
                        const panel = document.createElement('div');
                        panel.className = 'action-panel';
                        panel.id = 'approval-panel-' + stepId;
                        
                        const applyBtn = document.createElement('button');
                        applyBtn.textContent = action === 'run_command' ? 'Run Command' : 'Apply';
                        applyBtn.onclick = () => {
                            vscode.postMessage({ type: 'approveStep', stepId });
                            panel.remove();
                            setStatus('executing', action === 'run_command' ? 'Executing command...' : 'Writing file...');
                        };

                        const rejectBtn = document.createElement('button');
                        rejectBtn.className = 'reject';
                        rejectBtn.textContent = action === 'run_command' ? 'Cancel' : 'Reject';
                        rejectBtn.onclick = () => {
                            vscode.postMessage({ type: 'rejectStep', stepId });
                            panel.remove();
                            setStatus('idle', 'Ready');
                        };

                        panel.appendChild(applyBtn);
                        panel.appendChild(rejectBtn);
                        chatContainer.appendChild(panel);
                        chatContainer.scrollTop = chatContainer.scrollHeight;
                    }

                    function markStepDone(stepId) {
                        const stepEl = document.getElementById('step-' + stepId);
                        if (stepEl) {
                            stepEl.querySelector('.step-icon').textContent = '✅';
                        }
                    }

                    function markStepRejected(stepId) {
                        const stepEl = document.getElementById('step-' + stepId);
                        if (stepEl) {
                            stepEl.querySelector('.step-icon').textContent = '❌';
                        }
                    }

                    function appendResult(res) {
                        markStepDone(res.stepId);
                        if (res.output) {
                            const html = \`
                                <strong>Result step \${res.stepId}:</strong>
                                <div class="terminal-output-container">
                                    <div class="terminal-output-header">Terminal Output</div>
                                    <pre class="terminal-output-body">\${escapeHtml(res.output)}</pre>
                                </div>
                            \`;
                            appendAgentMessage(html);
                        } else {
                            appendAgentMessage(\`<strong>Result step \${res.stepId}:</strong> Executed step successfully.\`);
                        }
                    }

                    function showError(errText) {
                        appendAgentMessage(\`<strong style="color:var(--vscode-errorForeground)">Error:</strong> \${escapeHtml(errText)}\`);
                    }

                    function escapeHtml(text) {
                        return text
                            .replace(/&/g, "&amp;")
                            .replace(/</g, "&lt;")
                            .replace(/>/g, "&gt;")
                            .replace(/"/g, "&quot;")
                            .replace(/'/g, "&#039;");
                    }
                </script>
            </body>
            </html>`;
    }
}
