import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

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

    let openSidebarDisposable = vscode.commands.registerCommand('hermes.openSidebar', () => {
        vscode.commands.executeCommand('workbench.view.extension.hermes-sidebar');
    });

    context.subscriptions.push(startSessionDisposable);
    context.subscriptions.push(configureDisposable);
    context.subscriptions.push(openSidebarDisposable);
}

export function deactivate() {}

class HermesChatViewProvider implements vscode.WebviewViewProvider {
    private sessionId: string | null = null;
    private serverUrl = 'http://172.16.102.11:3000';
    private webviewView: vscode.WebviewView | null = null;

    constructor(private readonly _extensionUri: vscode.Uri) {}

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this.webviewView = webviewView;

        // Read configuration (host/port/url)
        const config = vscode.workspace.getConfiguration('hermes');
        const host = config.get<string>('serverHost') || '172.16.102.11';
        const port = config.get<number>('serverPort') || 3000;
        const customUrl = config.get<string>('serverUrl');
        this.serverUrl = (customUrl && customUrl !== 'http://172.16.102.11:3000')
            ? customUrl
            : `http://${host}:${port}`;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        webviewView.webview.html = this._getHtmlForWebview();

        // Handle webview disposal
        webviewView.onDidDispose(() => {
            this.webviewView = null;
        });

        // Listen to configuration changes
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('hermes')) {
                const newConfig = vscode.workspace.getConfiguration('hermes');
                const newHost = newConfig.get<string>('serverHost') || '172.16.102.11';
                const newPort = newConfig.get<number>('serverPort') || 3000;
                const newCustomUrl = newConfig.get<string>('serverUrl');
                const newUrl = (newCustomUrl && newCustomUrl !== 'http://172.16.102.11:3000')
                    ? newCustomUrl
                    : `http://${newHost}:${newPort}`;
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

    private _getHtmlForWebview(): string {
        const htmlPath = path.join(this._extensionUri.fsPath, 'media', 'webview.html');
        try {
            if (fs.existsSync(htmlPath)) {
                return fs.readFileSync(htmlPath, 'utf8');
            }
        } catch (e) {
            console.error('[Hermes] Failed to load webview.html:', e);
        }
        // Fallback HTML if file not found
        return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
  <title>Hermes Chat</title>
  <style>
    body { font-family: sans-serif; padding: 20px; color: #ccc; background: #1e1e1e; }
    h3 { color: #fff; }
    .info { color: #4ec9b0; }
    code { background: #2d2d2d; padding: 2px 6px; border-radius: 3px; }
  </style>
</head>
<body>
  <h3>Hermes Agent Bridge</h3>
  <p class="info">⚠️ webview.html not found. Extension may be corrupted.</p>
  <p>Expected path: <code>media/webview.html</code></p>
  <p>Please reinstall the extension.</p>
</body>
</html>`;
    }
}
