import * as vscode from 'vscode';

export class CodeCanvasEditorProvider implements vscode.CustomTextEditorProvider {

    public static register(context: vscode.ExtensionContext): vscode.Disposable {
        const provider = new CodeCanvasEditorProvider(context);
        const providerRegistration = vscode.window.registerCustomEditorProvider(CodeCanvasEditorProvider.viewType, provider);
        return providerRegistration;
    }

    private static readonly viewType = 'codecanvas.codeCanvas';

    constructor(
        private readonly context: vscode.ExtensionContext
    ) { }

    public async resolveCustomTextEditor(
        document: vscode.TextDocument,
        webviewPanel: vscode.WebviewPanel,
        _token: vscode.CancellationToken
    ): Promise<void> {
        // Setup initial content for the webview
        webviewPanel.webview.options = {
            enableScripts: true,
            localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media')]
        };

        webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview);

        function updateWebview() {
            webviewPanel.webview.postMessage({
                command: 'setValue',
                value: document.getText()
            });
        }

        // Hook up event listeners so that we can synchronize the webview with the text document.
        const changeDocumentSubscription = vscode.workspace.onDidChangeTextDocument(e => {
            if (e.document.uri.toString() === document.uri.toString()) {
                updateWebview();
            } else {
                // Determine if this is a file we might care about (optimisation: could be finer grained)
                webviewPanel.webview.postMessage({
                    command: 'fileChanged',
                    uri: e.document.uri.toString(),
                    content: e.document.getText()
                });
            }
        });

        // Make sure we get rid of the listener when our editor is closed.
        webviewPanel.onDidDispose(() => {
            changeDocumentSubscription.dispose();
        });

        // Receive message from the webview.
        webviewPanel.webview.onDidReceiveMessage(async e => {
            switch (e.command) {
                case 'updateState':
                    this.updateTextDocument(document, e.value);
                    return;
                case 'requestFileContent':
                    // This is for dropped files (new nodes)
                    this._handleFileRequest(webviewPanel.webview, e.uri, e.x, e.y);
                    return;
                case 'requestNodeContent':
                    // This is for restoring nodes (existing nodes)
                    this._handleNodeContentRequest(webviewPanel.webview, e.uri, e.nodeId);
                    return;
                case 'requestSymbols':
                    this._handleSymbolsRequest(webviewPanel.webview, e.uri, e.nodeId);
                    return;
                case 'saveFileContent':
                    this._handleSaveFile(e.uri, e.content);
                    return;
                case 'alert':
                    vscode.window.showErrorMessage(e.text);
                    return;
            }
        });

        updateWebview();
    }

    private getHtmlForWebview(webview: vscode.Webview): string {
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'script.js'));
        const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'style.css'));
        const prismJsUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'prism.js'));
        const prismCssUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'prism.css'));

        const nonce = getNonce();

        return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} https:; connect-src ${webview.cspSource} https:;">
                <link href="${styleUri}" rel="stylesheet">
                <link href="${prismCssUri}" rel="stylesheet">
                <title>CodeCanvas</title>
            </head>
            <body>
                <div id="canvas-container">
                    <div id="canvas-content">
                        <svg id="connections-layer"></svg>
                    </div>
                </div>
                <script nonce="${nonce}" src="${prismJsUri}"></script>
                <script nonce="${nonce}" src="${scriptUri}"></script>
            </body>
            </html>`;
    }

    private updateTextDocument(document: vscode.TextDocument, json: any) {
        const text = JSON.stringify(json, null, 2);
        if (document.getText() === text) {
            return;
        }

        const edit = new vscode.WorkspaceEdit();
        const wholeDocument = new vscode.Range(
            document.positionAt(0),
            document.lineAt(document.lineCount - 1).range.end
        );
        edit.replace(document.uri, wholeDocument, text);
        return vscode.workspace.applyEdit(edit);
    }

    private async _handleFileRequest(webview: vscode.Webview, uriString: string, x: number, y: number) {
        try {
            const uri = vscode.Uri.parse(uriString);
            const document = await vscode.workspace.openTextDocument(uri);
            const fileName = uri.path.split('/').pop() || uri.path;
            const content = document.getText();

            webview.postMessage({
                command: 'addNode',
                uri: uriString,
                fileName: fileName,
                content: content,
                x: x,
                y: y
            });
        } catch (e) {
            vscode.window.showErrorMessage('Failed to read file: ' + uriString);
        }
    }

    private async _handleNodeContentRequest(webview: vscode.Webview, uriString: string, nodeId: string) {
        try {
            const uri = vscode.Uri.parse(uriString);
            const document = await vscode.workspace.openTextDocument(uri);
            const content = document.getText();

            webview.postMessage({
                command: 'updateNodeContent',
                nodeId: nodeId,
                content: content
            });
        } catch (e) {
            webview.postMessage({
                command: 'updateNodeContent',
                nodeId: nodeId,
                content: 'Error loading content: ' + e
            });
        }
    }

    private async _handleSymbolsRequest(webview: vscode.Webview, uriString: string, nodeId: string) {
        try {
            const uri = vscode.Uri.parse(uriString);
            const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
                'vscode.executeDocumentSymbolProvider',
                uri
            );

            if (symbols) {
                // Flatten symbols for easier consumption in webview
                const flattened: any[] = [];
                const process = (s: vscode.DocumentSymbol) => {
                    flattened.push({
                        name: s.name,
                        kind: s.kind,
                        range: {
                            start: s.range.start,
                            end: s.range.end
                        }
                    });
                    s.children.forEach(process);
                };
                symbols.forEach(process);

                webview.postMessage({
                    command: 'updateSymbols',
                    nodeId: nodeId,
                    symbols: flattened
                });
            }
        } catch (e) {
            console.error('Failed to get symbols:', e);
        }
    }

    private async _handleSaveFile(uriString: string, content: string) {
        try {
            const uri = vscode.Uri.parse(uriString);
            const data = Buffer.from(content, 'utf8');
            await vscode.workspace.fs.writeFile(uri, data);
        } catch (e) {
            vscode.window.showErrorMessage('Failed to save file: ' + uriString);
        }
    }
}

function getNonce() {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}
