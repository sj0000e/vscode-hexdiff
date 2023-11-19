import * as vscode from 'vscode';
import * as hexdiff from './hexdiff';

export function activate(context: vscode.ExtensionContext) {
	context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider(hexdiff.scheme, hexdiff.docProvider));
	vscode.window.onDidChangeTextEditorSelection(hexdiff.updateStatusBar);
	vscode.workspace.onDidChangeConfiguration(hexdiff.updateConfiguration);
	context.subscriptions.push(hexdiff.positionStatusBar);
	context.subscriptions.push(vscode.commands.registerCommand('hexdiff.compare', hexdiff.openDiff));
	context.subscriptions.push(vscode.commands.registerCommand("hexdiff.previous", hexdiff.prevDiff));
	context.subscriptions.push(vscode.commands.registerCommand("hexdiff.next", hexdiff.nextDiff));
}

export function deactivate() { }