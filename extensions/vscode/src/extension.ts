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

    // Register Command
    let disposable = vscode.commands.registerCommand('hermes.startSession', () => {
        vscode.window.showInformationMessage('Hermes Session Started');
    });

    context.subscriptions.push(disposable);
}

export function deactivate() {}

class HermesChatViewProvider implements vscode.WebviewViewProvider {
    private sessionId: string | null = null;
    private serverUrl = 'http://127.0.0.1:3000';

    constructor(private readonly _extensionUri: vscode.Uri) {}

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        webviewView.webview.html = this._getHtmlForWebview();
        
        // Start Session
        this.startSession().then(id => {
            this.sessionId = id;
            webviewView.webview.postMessage({ type: 'receive', value: `Connected to Hermes Server. Session ID: ${id}` });
        }).catch(err => {
            webviewView.webview.postMessage({ type: 'receive', value: `Failed to connect to Hermes Server: ${err.message}` });
        });

        webviewView.webview.onDidReceiveMessage(async data => {
            switch (data.type) {
                case 'chat':
                    {
                        if (!this.sessionId) {
                            webviewView.webview.postMessage({ type: 'receive', value: 'Error: No active session.' });
                            return;
                        }
                        try {
                            const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '/tmp/test';
                            const response = await fetch(`${this.serverUrl}/v1/agent/run`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    session_id: this.sessionId,
                                    task: data.value,
                                    workspace: { root: workspaceRoot },
                                    mode: 'review'
                                })
                            });

                            if (!response.body) throw new Error('No response body');

                            const reader = response.body.getReader();
                            const decoder = new TextDecoder();
                            let done = false;

                            while (!done) {
                                const { value, done: readerDone } = await reader.read();
                                done = readerDone;
                                if (value) {
                                    const chunk = decoder.decode(value);
                                    const lines = chunk.split('\n');
                                    let currentEvent = '';
                                    for (const line of lines) {
                                        if (line.startsWith('event: ')) {
                                            currentEvent = line.replace('event: ', '').trim();
                                        } else if (line.startsWith('data: ')) {
                                            const dataStr = line.replace('data: ', '').trim();
                                            webviewView.webview.postMessage({ type: 'receive', value: `[${currentEvent}] ${dataStr}` });
                                        }
                                    }
                                }
                            }
                        } catch (err: any) {
                            webviewView.webview.postMessage({ type: 'receive', value: `Error: ${err.message}` });
                        }
                        break;
                    }
            }
        });
    }

    private async startSession(): Promise<string> {
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '/tmp/test';
        const res = await fetch(`${this.serverUrl}/v1/session/start`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ workspace: workspaceRoot, profile: 'ILMA' })
        });
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
                    body { font-family: var(--vscode-font-family); padding: 10px; }
                    .chat-box { height: 300px; overflow-y: auto; border: 1px solid var(--vscode-panel-border); margin-bottom: 10px; padding: 5px; }
                    .message { margin-bottom: 5px; }
                    input { width: 100%; padding: 5px; box-sizing: border-box; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); }
                </style>
            </head>
            <body>
                <div class="chat-box" id="chatBox">
                    <div class="message"><strong>Hermes:</strong> Ready.</div>
                </div>
                <input type="text" id="chatInput" placeholder="Ask Hermes..." />

                <script>
                    const vscode = acquireVsCodeApi();
                    const input = document.getElementById('chatInput');
                    const chatBox = document.getElementById('chatBox');

                    input.addEventListener('keypress', (e) => {
                        if (e.key === 'Enter' && input.value) {
                            const val = input.value;
                            chatBox.innerHTML += \`<div class="message"><strong>You:</strong> \${val}</div>\`;
                            vscode.postMessage({ type: 'chat', value: val });
                            input.value = '';
                        }
                    });

                    window.addEventListener('message', event => {
                        const message = event.data;
                        if (message.type === 'receive') {
                            chatBox.innerHTML += \`<div class="message"><strong>Hermes:</strong> \${message.value}</div>\`;
                            chatBox.scrollTop = chatBox.scrollHeight;
                        }
                    });
                </script>
            </body>
            </html>`;
    }
}
