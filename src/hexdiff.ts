import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export const scheme = 'hexdiff';

let bytesPerLine: number;
let sizeWarning: number;
let isDrawUnderscore: boolean;
let backgroundColor: string;
let overviewRulerColor: string;
const offsetLeft = 10;
let offsetRight: number;
let offsetChar: number;


function getFileSize(filePath:string) : number {
    const fileStat = fs.statSync(filePath);
    return fileStat ? fileStat.size: -1;
}

export function updateConfiguration() {
    const config = vscode.workspace.getConfiguration('hexdiff');
    bytesPerLine = config['bytesPerLine'];
    sizeWarning = config['sizeWarning'];
    isDrawUnderscore = config['isDrawUnderscore'];
    backgroundColor = config['backgroundColor'];
    overviewRulerColor = config['overviewRulerColor'];
    offsetRight = offsetLeft + bytesPerLine * 4 + 18;
    offsetChar = bytesPerLine * 3 + 3;
}


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
    const lines = Math.ceil(data.length / bytesPerLine);
    const xxdLines = new Array(lines);
    const wordSeperator = isDrawUnderscore ? '_' : ' ';
    for (let line = 0; line < lines; line++) {
        const chunk = data.slice(line * bytesPerLine, (line + 1) * bytesPerLine);
        const offset = line.toString(16).padStart(7, '0') + '0';
        const hexLine = new Array(bytesPerLine).fill("   ");
        const asciiLine = new Array(bytesPerLine).fill(" ");
        for (let i = 0; i < chunk.length; i++) {
            const byte = chunk[i];
            hexLine[i] = hexDictionary[byte] + (i % 4 !== 3 ? wordSeperator : ' ');
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
function convertToVscodeRanges(differentRanges: [number, number][]): [vscode.Range[], vscode.Range[]] {
    const vscodeRangesIndex: vscode.Range[] = [];
    const vscodeRangesDisplay: vscode.Range[] = [];

    for (const [start, end] of differentRanges) {
        const startLine = Math.floor(start / bytesPerLine);
        const startChar = (start % bytesPerLine);
        const startHex = (start % bytesPerLine) * 3;
        const endLine = Math.floor(end / bytesPerLine);
        const endChar = (end % bytesPerLine);
        const endHex = (end % bytesPerLine) * 3 - 1;
        vscodeRangesIndex.push(new vscode.Range(startLine, offsetLeft + startHex, endLine, offsetRight + offsetChar + endChar));
        for (let line = startLine; line <= endLine; line++) {
            const startX = line === startLine ? startHex : 0;
            const endX = line === endLine ? endHex : (bytesPerLine * 3 - 1);
            const startXChar = offsetChar + (line === startLine ? startChar : 0);
            const endXChar = offsetChar + (line === endLine ? endChar : bytesPerLine);
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

let startTime: number;
export const docProvider = new class implements vscode.TextDocumentContentProvider {
    onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri>();
    onDidChange = this.onDidChangeEmitter.event;
    provideTextDocumentContent(uri: vscode.Uri): string {
        // console.log(`show mid: ${performance.now()-startTime} ms`);

        updateConfiguration();

        const path0 = decodeURIComponent(uri.query);
        const path1 = decodeURIComponent(uri.fragment);
        const binaryData0 = readFileToUint8Array(path0);
        const binaryData1 = readFileToUint8Array(path1);
        // console.log(`read time: ${performance.now()-startTime} ms`);
        const xxd0 = uint8ArrayToXxd(binaryData0);
        const xxd1 = uint8ArrayToXxd(binaryData1);
        // console.log(`xxd time: ${performance.now()-startTime} ms`);


        const diffs = findBinaryDifferentRanges(binaryData0, binaryData1);
        [diffRangesIndex, diffRangesDisplay] = convertToVscodeRanges(diffs);
        diffRangesIndexReverse = [...diffRangesIndex].reverse();

        const contents = combineLines(xxd0, xxd1);



        // update when file changed
        // const watcher0 = vscode.workspace.createFileSystemWatcher(path0);
        // const watcher1 = vscode.workspace.createFileSystemWatcher(path0);
        // watcher0.onDidChange(() => {
        // });

        // context.subscriptions.push(watcher0);
        // context.subscriptions.push(watcher1);


        return contents;
    }
};

let diffRangesIndex: vscode.Range[];
let diffRangesDisplay: vscode.Range[];
let diffRangesIndexReverse: vscode.Range[];
let diffViewer: vscode.TextEditor;
export async function openDiff(...file: any[]) {
    startTime = performance.now();
    

    const path0 = file[1][0].fsPath;
    const path1 = file[1][1].fsPath;
    const size0 = getFileSize(path0);
    const size1 = getFileSize(path1);
    if (size0 > sizeWarning || size1 > sizeWarning ) {
        await vscode.window.showWarningMessage('File is too large to open.', 'OK');
        return;
    }

    const upath0 = encodeURIComponent(path0);
    const upath1 = encodeURIComponent(path1);
    const title = `${path0} ↔ ${path.basename(path1)} `;
    // const title = `${path0} ↔ ${path1} `;

    // console.log(`combine time: ${performance.now()-startTime} ms`);
    const hexdiffUri = vscode.Uri.from({scheme:scheme, path:title, query:upath0, fragment:upath1});
    // console.log(`show start: ${performance.now()-startTime} ms`);
    diffViewer = await vscode.window.showTextDocument(hexdiffUri);
    // console.log(`show time: ${performance.now()-startTime} ms`);

    if (diffRangesDisplay.length) {
        await diffViewer.setDecorations(vscode.window.createTextEditorDecorationType({
            backgroundColor: backgroundColor,
            overviewRulerColor: overviewRulerColor
        }), diffRangesDisplay);
    } else {
        vscode.window.showInformationMessage(`Files ${path.basename(path1)} and ${path.basename(path1)} are identical!\n${path0} ↔ ${path1}`);
    }
    // console.log(`doc end: ${performance.now()-startTime} ms`);

};

export function prevDiff() {
    const currentPosition = diffViewer.selection.start;
    const nextDecoration = diffRangesIndexReverse.find(range => range.start.isBefore(currentPosition));
    if (nextDecoration) {
        diffViewer.selection = new vscode.Selection(nextDecoration.start, nextDecoration.end);
        diffViewer.revealRange(nextDecoration);
    }
};
export function nextDiff() {
    const currentPosition = diffViewer.selection.start;
    const nextDecoration = diffRangesIndex.find(range => range.start.isAfter(currentPosition));
    if (nextDecoration) {
        diffViewer.selection = new vscode.Selection(nextDecoration.start, nextDecoration.end);
        diffViewer.revealRange(nextDecoration);
    }
};

export const positionStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right);
let statusVisible = false;
export function updateStatusBar(event: vscode.TextEditorSelectionChangeEvent) {
    if (event.textEditor.document.uri.scheme !== scheme) {
        (statusVisible) && positionStatusBar.hide();
        return;
    }
    (!statusVisible) && positionStatusBar.show();

    const currentSelection = event.selections[0].start;
    let bytePosition: number;
    switch (true) {
        case currentSelection.character >= 0 && currentSelection.character < offsetLeft + offsetChar - 1:
            bytePosition = Math.max(0, Math.min(Math.floor((currentSelection.character - offsetLeft) / 3), bytesPerLine - 1));
            break;
        case currentSelection.character >= offsetLeft + offsetChar - 1 && currentSelection.character < offsetLeft + offsetChar + bytesPerLine + 3:
            bytePosition = Math.max(0, Math.min(Math.floor((currentSelection.character - (offsetLeft + offsetChar))), bytesPerLine - 1));
            break;
        case currentSelection.character >= offsetLeft + offsetChar + bytesPerLine + 3 && currentSelection.character < offsetRight + offsetChar - 1:
            bytePosition = Math.max(0, Math.min(Math.floor((currentSelection.character - (offsetRight)) / 3), bytesPerLine - 1));
            break;
        default:
            bytePosition = Math.max(0, Math.min(Math.floor((currentSelection.character - (offsetRight + offsetChar))), bytesPerLine - 1));
            break;
    }
    const currentPosition = currentSelection.line * bytesPerLine + bytePosition;
    positionStatusBar.text = `Hexdiff Position: ${currentPosition}(0x${currentPosition.toString(16)})`;
}


