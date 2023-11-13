import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export function activate(context: vscode.ExtensionContext) {
	const bytePerLine = 16;
	const hexDictionary = new Array(256);
	const asciiDictionary = new Array(256);
	for (let i = 0; i < 256; i++) {
		hexDictionary[i] = i.toString(16).padStart(2, '0').toUpperCase();
		if (i >= 32 && i <= 126) {
			asciiDictionary[i] = String.fromCharCode(i);
		} else {
			asciiDictionary[i] = '.';
		}
	}
	function readFileToUint8Array(filePath: string): Uint8Array {
		try {
			const fileData = fs.readFileSync(filePath);
			return new Uint8Array(fileData);
		} catch (error: any) {
			return new Uint8Array(0);
		}
	}
	function uint8ArrayToXxd(data: Uint8Array): string {
		const lines = Math.ceil(data.length / bytePerLine);
		const xxdLines = new Array(lines);
		for (let line = 0; line < lines; line++) {
			const chunk = data.slice(line * bytePerLine, (line + 1) * bytePerLine);
			const offset = line.toString(16).padStart(7, '0') + '0';
			const hexLine = new Array(bytePerLine).fill("   ");
			const asciiLine = new Array(bytePerLine).fill(" ");
			for (let i = 0; i < chunk.length; i++) {
				const byte = chunk[i];
				hexLine[i] = hexDictionary[byte] + (i % 4 !== 3 ? ' ' : ' ');
				asciiLine[i] = asciiDictionary[byte];
			}
			xxdLines[line] = `${offset}: ${hexLine.join('')} | ${asciiLine.join('')}`;
		}
		return xxdLines.join('\n');
	}
	function findBinaryDifferentRanges(arr1: Uint8Array, arr2: Uint8Array): [number, number][] {
		const differentRanges: [number, number][] = [];
		let start: number = -1;
		let end: number = -1;
		let isDiffStart: boolean = false;
		const minLength = Math.min(arr1.length, arr2.length);
		const maxLength = Math.max(arr1.length, arr2.length);

		for (let i = 0; i < minLength; i++) {
			if (!isDiffStart) {
				if (arr1[i] !== arr2[i]) {
					start = i;
					isDiffStart = true;
				}
			} else {
				if (arr1[i] === arr2[i]) {
					end = i;
					differentRanges.push([start, end]);
					isDiffStart = false;
				}
			}
		}

		if (isDiffStart) {
			differentRanges.push([start, maxLength]);
		} else if (minLength !== maxLength) {
			differentRanges.push([minLength, maxLength]);
		}
		return differentRanges;
	}
	const offsetLeft = 10;
	const offsetRight = offsetLeft + bytePerLine * 4 + 18;
	const offsetChar = bytePerLine * 3 + 3;

	function convertToVscodeRanges(differentRanges: [number, number][]): [vscode.Range[], vscode.Range[]] {
		const vscodeRangesIndex: vscode.Range[] = [];
		const vscodeRangesDisplay: vscode.Range[] = [];

		for (const [start, end] of differentRanges) {
			const startLine = Math.floor(start / bytePerLine);
			const startChar = (start % bytePerLine);
			const startHex = (start % bytePerLine) * 3;
			const endLine = Math.floor(end / bytePerLine);
			const endChar = (end % bytePerLine);
			const endHex = (end % bytePerLine) * 3 - 1;
			vscodeRangesIndex.push(new vscode.Range(startLine, offsetLeft + startHex, endLine, offsetRight + offsetChar + endChar));
			for (let line = startLine; line <= endLine; line++) {
				const startX = line === startLine ? startHex : 0;
				const endX = line === endLine ? endHex : (bytePerLine * 3 - 1);
				const startXChar = offsetChar + (line === startLine ? startChar : 0);
				const endXChar = offsetChar + (line === endLine ? endChar : bytePerLine);
				vscodeRangesDisplay.push(new vscode.Range(line, offsetLeft + startX, line, offsetLeft + endX));
				vscodeRangesDisplay.push(new vscode.Range(line, offsetLeft + startXChar, line, offsetLeft + endXChar));
				vscodeRangesDisplay.push(new vscode.Range(line, offsetRight + startX, line, offsetRight + endX));
				vscodeRangesDisplay.push(new vscode.Range(line, offsetRight + startXChar, line, offsetRight + endXChar));
			}
		}
		return [vscodeRangesIndex, vscodeRangesDisplay];
	}
	function combineLines(input1: string, input2: string): string {
		const lines1 = input1.split('\n');
		const lines2 = input2.split('\n');
		const combinedLines: string[] = [];
		const maxLines = Math.max(lines1.length, lines2.length);

		for (let i = 0; i < maxLines; i++) {
			const line1 = i < lines1.length ? lines1[i] : ' '.repeat(92); // lines1의 i번째 라인 또는 빈 문자열
			const line2 = i < lines2.length ? lines2[i] : ' '.repeat(92); // lines2의 i번째 라인 또는 빈 문자열
			combinedLines.push(`${line1}  |  ${line2}`);
		}
		return combinedLines.join('\n');
	}

	const hexdiffscheme = 'hexdiff';
	const hexdiffDocProvider = new class implements vscode.TextDocumentContentProvider {
		onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri>();
		onDidChange = this.onDidChangeEmitter.event;
		provideTextDocumentContent(uri: vscode.Uri): string {
			return uri.query;
		}
	};
	context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider(hexdiffscheme, hexdiffDocProvider));

	let diffRangesIndex: vscode.Range[];
	let diffRangesIndexReverse: vscode.Range[];
	let diffViewer: vscode.TextEditor;
	async function openDiff(...file: any[]) {
		const path0 = vscode.Uri.parse(file[1][0]).path;
		const path1 = vscode.Uri.parse(file[1][1]).path;
		const binaryData0 = readFileToUint8Array(path0);
		const binaryData1 = readFileToUint8Array(path1);
		const xxd0 = uint8ArrayToXxd(binaryData0);
		const xxd1 = uint8ArrayToXxd(binaryData1);
		const diffs = findBinaryDifferentRanges(binaryData0, binaryData1);
		let diffRangesDisplay: vscode.Range[];
		[diffRangesIndex, diffRangesDisplay] = convertToVscodeRanges(diffs);
		diffRangesIndexReverse = [...diffRangesIndex].reverse();

		const title = `${path0} ↔ ${path.basename(path1)} `;
		// const title = `${path0} ↔ ${path1} `;
		const contents = encodeURIComponent(combineLines(xxd0, xxd1));
		const hexdiffUri = vscode.Uri.parse(`${hexdiffscheme}:${title}?${contents}`);  //use query for contents
		diffViewer = await vscode.window.showTextDocument(hexdiffUri);

		if (diffRangesDisplay.length) {
			await diffViewer.setDecorations(vscode.window.createTextEditorDecorationType({
				backgroundColor: 'rgba(255, 0, 0, 0.3)'
			}), diffRangesDisplay);
		} else {
			vscode.window.showInformationMessage(`Files ${path.basename(path1)} and ${path.basename(path1)} are identical!\n${path0} ↔ ${path1}`);
		}
		//nextDiff();
	};

	function prevDiff() {
		const currentPosition = diffViewer.selection.start;
		const nextDecoration = diffRangesIndexReverse.find(range => range.start.isBefore(currentPosition));
		if (nextDecoration) {
			diffViewer.selection = new vscode.Selection(nextDecoration.start, nextDecoration.end);
			diffViewer.revealRange(nextDecoration);
		}
	};
	function nextDiff() {
		const currentPosition = diffViewer.selection.start;
		const nextDecoration = diffRangesIndex.find(range => range.start.isAfter(currentPosition));
		if (nextDecoration) {
			diffViewer.selection = new vscode.Selection(nextDecoration.start, nextDecoration.end);
			diffViewer.revealRange(nextDecoration);
		}
	};

	const statusBarPosition = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right);
	statusBarPosition.show();
	function updateStatusBar(event: vscode.TextEditorSelectionChangeEvent) {
		const currentSelection = event.selections[0].start;
		let bytePosition: number;
		switch (true) {
			case currentSelection.character >= 0 && currentSelection.character < offsetLeft + offsetChar - 1:
				bytePosition = Math.max(0, Math.min(Math.floor((currentSelection.character - offsetLeft) / 3), bytePerLine - 1));
				break;
			case currentSelection.character >= offsetLeft + offsetChar - 1 && currentSelection.character < offsetLeft + offsetChar + bytePerLine + 3:
				bytePosition = Math.max(0, Math.min(Math.floor((currentSelection.character - (offsetLeft + offsetChar))), bytePerLine - 1));
				break;
			case currentSelection.character >= offsetLeft + offsetChar + bytePerLine + 3 && currentSelection.character < offsetRight + offsetChar - 1:
				bytePosition = Math.max(0, Math.min(Math.floor((currentSelection.character - (offsetRight)) / 3), bytePerLine - 1));
				break;
			default:
				bytePosition = Math.max(0, Math.min(Math.floor((currentSelection.character - (offsetRight + offsetChar))), bytePerLine - 1));
				break;
		}
		const currentPosition = currentSelection.line * bytePerLine + bytePosition;
		statusBarPosition.text = `Hexdiff Position: ${currentPosition}(0x${currentPosition.toString(16)})`;
	}
	vscode.window.onDidChangeTextEditorSelection(updateStatusBar);
	context.subscriptions.push(statusBarPosition);


	context.subscriptions.push(vscode.commands.registerCommand('hexdiff.compare', openDiff));
	context.subscriptions.push(vscode.commands.registerCommand("hexdiff.previous", prevDiff));
	context.subscriptions.push(vscode.commands.registerCommand("hexdiff.next", nextDiff));

}

export function deactivate() { }