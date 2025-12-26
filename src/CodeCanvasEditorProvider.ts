import * as vscode from 'vscode';

export class CodeCanvasEditorProvider implements vscode.CustomTextEditorProvider {

    public static register(context: vscode.ExtensionContext): vscode.Disposable {
        const provider = new CodeCanvasEditorProvider(context);
        const providerRegistration = vscode.window.registerCustomEditorProvider(
            CodeCanvasEditorProvider.viewType,
            provider,
            {
                webviewOptions: {
                    retainContextWhenHidden: true,
                }
            }
        );
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
            localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media')],
            enableForms: true
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
                case 'exportJson':
                    this._handleExportJson(document.uri, e.value);
                    return;
                case 'exportPdf':
                    this._handleExportPdf(document.uri, e.value);
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
                <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline' https:; font-src https:; script-src 'nonce-${nonce}' https: 'unsafe-eval'; img-src ${webview.cspSource} https: data:; connect-src ${webview.cspSource} https:;">
                <link href="${styleUri}" rel="stylesheet">
                <link id="prism-theme" href="${prismCssUri}" rel="stylesheet">
                <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.1/font/bootstrap-icons.css">
                <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
                <script src="https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js"></script>
                <script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"></script>
                <title>CodeCanvas</title>
            </head>
            <body>
                <div id="canvas-container">
                    <div id="canvas-content">
                        <svg id="connections-layer"></svg>
                    </div>
                </div>

                <div id="toolbox" class="toolbox">
                    <div class="toolbox-section main-section">
                        <div id="add-node-btn" class="add-node-btn" title="Add Text Block">
                            <i class="bi bi-plus-lg"></i>
                        </div>
                    </div>
                    
                    <div id="edge-controls" class="toolbox-section edge-controls hidden">
                        <div class="toolbar-divider"></div>
                        <i class="bi bi-distribute-vertical" title="Thickness"></i>
                        <input type="range" id="edge-thickness" min="0.5" max="10" step="0.5" value="1">
                        <span id="thickness-label">1px</span>
                        <div class="toolbar-divider"></div>
                        <i class="bi bi-palette" title="Color"></i>
                        <div class="color-swatches">
                            <div class="swatch default active" data-color="default" title="Default Color"></div>
                            <div class="swatch red" data-color="#ff5f56" title="Red"></div>
                            <div class="swatch green" data-color="#28c840" title="Green"></div>
                            <div class="swatch yellow" data-color="#febc2e" title="Yellow"></div>
                            <div class="swatch purple" data-color="#af52de" title="Purple"></div>
                            <div class="swatch white" data-color="#ffffff" title="White"></div>
                        </div>
                        <div class="toolbar-divider"></div>
                        <div class="unlink-btn" id="unlink-btn" title="Unlink Connection">
                            <i class="fas fa-link-slash"></i>
                            <span>Unlink</span>
                        </div>
                    </div>

                    <div id="node-controls" class="toolbox-section node-controls hidden">
                        <div class="toolbar-divider"></div>
                        <i class="bi bi-type" title="Font Size"></i>
                        <input type="range" id="node-font-size" min="8" max="24" step="1" value="13">
                        <span id="font-size-label">13px</span>
                        <div class="toolbar-divider"></div>
                        <div class="node-duplicate-btn" id="node-duplicate-btn" title="Duplicate Node">
                            <i class="bi bi-copy"></i>
                            <span>Duplicate</span>
                        </div>
                        <div class="toolbar-divider"></div>
                        <div class="node-unlink-btn" id="node-unlink-all-btn" title="Unlink All Connections">
                            <i class="fas fa-link-slash"></i>
                            <span>Unlink All</span>
                        </div>
                        <div class="toolbar-divider"></div>
                        <div class="node-delete-btn" id="node-delete-btn-toolbar" title="Delete Node">
                            <i class="fas fa-trash-can"></i>
                            <span>Delete</span>
                        </div>
                    </div>
                </div>

                <div class="settings-container">
                    <div id="settings-btn" class="settings-btn" title="Canvas Settings">
                        <i class="bi bi-gear-fill"></i>
                    </div>
                    <div id="settings-menu" class="settings-menu hidden">
                        <div class="menu-group">
                            <label>Background Pattern</label>
                            <div class="pattern-options">
                                <button class="pattern-opt active" data-pattern="plain" title="Plain">None</button>
                                <button class="pattern-opt" data-pattern="dotted" title="Dotted">Dots</button>
                                <button class="pattern-opt" data-pattern="grid" title="Grid">Grid</button>
                                <button class="pattern-opt" data-pattern="criss-cross" title="Criss Cross">Diagonal</button>
                            </div>
                        </div>
                        <div class="menu-divider"></div>
                        <div class="menu-group">
                            <label>Theme</label>
                            <div class="theme-options">
                                <button class="theme-opt active" data-theme="none"><i class="bi bi-circle-half"></i> None</button>
                                <button class="theme-opt" data-theme="dark"><i class="bi bi-moon-stars-fill"></i> Dark</button>
                                <button class="theme-opt" data-theme="light"><i class="bi bi-sun-fill"></i> Light</button>
                            </div>
                        </div>
                        <div class="menu-divider"></div>
                        <div class="menu-group">
                            <label>Code Theme</label>
                            <div class="code-theme-options">
                                <button class="code-theme-opt active" data-code-theme="default">Default</button>
                                <button class="code-theme-opt" data-code-theme="okaidia">Okaidia</button>
                                <button class="code-theme-opt" data-code-theme="tomorrow">Tomorrow</button>
                                <button class="code-theme-opt" data-code-theme="solarizedlight">Solarized</button>
                                <button class="code-theme-opt" data-code-theme="twilight">Twilight</button>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="share-container">
                    <div id="share-btn" class="share-btn" title="Share / Export">
                        <i class="bi bi-share-fill"></i>
                    </div>
                    <div id="share-menu" class="share-menu hidden">
                        <div class="menu-group">
                            <label>Export Canvas</label>
                            <button class="share-opt" id="export-json-btn">
                                <i class="bi bi-filetype-json"></i> Export as JSON
                            </button>
                            <button class="share-opt" id="export-pdf-btn">
                                <i class="bi bi-file-pdf"></i> Export as PDF
                            </button>
                        </div>
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

    private async _handleExportJson(baseUri: vscode.Uri, json: any) {
        try {
            const exportUri = baseUri.with({ path: baseUri.path.replace(/\.codecanvas$/, '.export.json') });
            const data = Buffer.from(JSON.stringify(json, null, 2), 'utf8');
            await vscode.workspace.fs.writeFile(exportUri, data);
            vscode.window.showInformationMessage('Canvas exported as JSON: ' + vscode.workspace.asRelativePath(exportUri));
        } catch (e) {
            vscode.window.showErrorMessage('Failed to export JSON: ' + e);
        }
    }

    private async _handleExportPdf(baseUri: vscode.Uri, dataUri: string) {
        try {
            const exportUri = baseUri.with({ path: baseUri.path.replace(/\.codecanvas$/, '.pdf') });
            const base64Data = dataUri.split(',')[1];
            const data = Buffer.from(base64Data, 'base64');
            await vscode.workspace.fs.writeFile(exportUri, data);
            vscode.window.showInformationMessage('Canvas exported as PDF: ' + vscode.workspace.asRelativePath(exportUri));
        } catch (e) {
            vscode.window.showErrorMessage('Failed to export PDF: ' + e);
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
