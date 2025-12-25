import * as vscode from 'vscode';
import { CodeCanvasEditorProvider } from './CodeCanvasEditorProvider';

export function activate(context: vscode.ExtensionContext) {
    console.log('CodeCanvas extension is active!');

    // Register our custom editor provider
    context.subscriptions.push(CodeCanvasEditorProvider.register(context));

    const disposable = vscode.commands.registerCommand('codecanvas.start', () => {
        // Ideally checking for active .codecanvas file or creating one
        vscode.window.showInformationMessage('CodeCanvas: Open a .codecanvas file to start.');
    });

    context.subscriptions.push(disposable);
}

export function deactivate() { }
