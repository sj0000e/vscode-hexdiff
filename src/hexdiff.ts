import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export const scheme = 'hexdiff';
let config :vscode.WorkspaceConfiguration;
    // let config.bytesPerLine: number;
    // let config.sizeContrast: number;
    // let config.isDrawUnderscore: boolean;
    // let config.backgroundColor: string;
    // let config.overviewRulerColor: string;
    // let config.isContrastMode: boolean;
    // let config.sizeContext: number;
const offsetLeft = 10;
let offsetRight: number;
let offsetChar: number;


function getFileSize(filePath:string) : number {
    const fileStat = fs.statSync(filePath);
    return fileStat ? fileStat.size: -1;
}

export function updateConfiguration() {
    config = vscode.workspace.getConfiguration('hexdiff');
    offsetRight = offsetLeft + config.bytesPerLine * 4 + 18;
    offsetChar = config.bytesPerLine * 3 + 3;
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
function uint8ArrayToXxd(data: Uint8Array,startByte: number, endByte: number): string {
    const startLine = Math.floor(startByte/config.bytesPerLine);
    const endLine = Math.ceil(endByte/config.bytesPerLine);
    const xxdLines = new Array(endLine-startLine);
    const wordSeperator = config.isDrawUnderscore ? '_' : ' ';
    for (let line = startLine; line < endLine; line++) {
        const chunk = data.slice(line * config.bytesPerLine, (line + 1) * config.bytesPerLine);
        const offset = line.toString(16).padStart(7, '0') + '0';
        const hexLine = new Array(config.bytesPerLine).fill("   ");
        const asciiLine = new Array(config.bytesPerLine).fill(" ");
        for (let i = 0; i < chunk.length; i++) {
            const byte = chunk[i];
            hexLine[i] = hexDictionary[byte] + (i % 4 !== 3 ? wordSeperator : ' ');
            asciiLine[i] = asciiDictionary[byte];
        }
        xxdLines[line-startLine] = `${offset}: ${hexLine.join('')} | ${asciiLine.join('')}`;
    }
    return xxdLines.join('\n');
}
interface Range {
    start: number;
    end: number;
}

function mergeRanges(ranges: Range[],endLimit:number): [Range, Range[]][] {
    const mergedRanges:[Range, Range[]][] = [];
    let withContext = {...ranges[0]};
    withContext.start = Math.max(0, Math.floor((withContext.start-config.sizeContext)/config.bytesPerLine)*config.bytesPerLine);
    withContext.end = Math.min(endLimit,withContext.end+config.sizeContext);
    let sourceRanges = [ranges[0]];
    sourceRanges[0].end = Math.min(endLimit,sourceRanges[0].end);
    for (let i = 1; i < ranges.length; i++) {
        const current = ranges[i];
        current.end = Math.min(endLimit,current.end);
        if (current.start - withContext.end <= config.sizeContext) { //merge
            withContext.end = Math.min(endLimit,current.end+config.sizeContext);;
            sourceRanges.push(current);
        } else {
            mergedRanges.push([withContext,sourceRanges]);
            withContext = {...current};
            withContext.start = Math.floor((withContext.start-config.sizeContext)/config.bytesPerLine)*config.bytesPerLine;
            withContext.end = Math.min(endLimit,current.end+config.sizeContext);;
            sourceRanges=[current];
        }
    }
    mergedRanges.push([withContext,sourceRanges]);
    return mergedRanges;
}


function findBinaryDifferentRanges(arr1: Uint8Array, arr2: Uint8Array): Range[] {
    const differentRanges: Range[] = [];
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
                differentRanges.push({start:start, end:end});
                isDiffStart = false;
            }
        }
    }

    if (isDiffStart) {
        differentRanges.push({start:start, end:maxLength});
    } else if (minLength !== maxLength) {
        differentRanges.push({start:minLength, end:maxLength});
    }
    return differentRanges;
}
function convertToVscodeRanges(differentRanges: Range[],rangeStart:number,displayLine:number): [vscode.Range[], vscode.Range[]] {
    const vscodeRangesIndex: vscode.Range[] = [];
    const vscodeRangesDisplay: vscode.Range[] = [];

    for (const {start, end} of differentRanges) {
        const startDiff = start -rangeStart;
        const endDiff = end -rangeStart;
        const startLine = Math.floor(startDiff / config.bytesPerLine);
        const startChar = (startDiff % config.bytesPerLine);
        const startHex = (startDiff % config.bytesPerLine) * 3;
        const endLine = Math.floor(endDiff / config.bytesPerLine);
        const endChar = (endDiff % config.bytesPerLine);
        const endHex = (endDiff % config.bytesPerLine) * 3 - 1;
        vscodeRangesIndex.push(new vscode.Range(displayLine+startLine, offsetLeft + startHex, displayLine+endLine, offsetRight + offsetChar + endChar));
        for (let line = startLine; line <= endLine; line++) {
            const startX = line === startLine ? startHex : 0;
            const endX = line === endLine ? endHex : (config.bytesPerLine * 3 - 1);
            const startXChar = offsetChar + (line === startLine ? startChar : 0);
            const endXChar = offsetChar + (line === endLine ? endChar : config.bytesPerLine);
            vscodeRangesDisplay.push(new vscode.Range(displayLine+line, offsetLeft + startX, displayLine+line, offsetLeft + endX));
            vscodeRangesDisplay.push(new vscode.Range(displayLine+line, offsetLeft + startXChar, displayLine+line, offsetLeft + endXChar));
            vscodeRangesDisplay.push(new vscode.Range(displayLine+line, offsetRight + startX, displayLine+line, offsetRight + endX));
            vscodeRangesDisplay.push(new vscode.Range(displayLine+line, offsetRight + startXChar, displayLine+line, offsetRight + endXChar));
        }
    }
    return [vscodeRangesIndex, vscodeRangesDisplay];
}
function combineLines(input1: string, input2: string): [string,number] {
    const lines1 = input1.split('\n');
    const lines2 = input2.split('\n');
    const combinedLines: string[] = [];
    const maxLines = Math.max(lines1.length, lines2.length);

    for (let i = 0; i < maxLines; i++) {
        const line1 = i < lines1.length ? lines1[i] : ' '.repeat(config.bytesPerLine*4+13); // lines1의 i번째 라인 또는 빈 문자열
        const line2 = i < lines2.length ? lines2[i] : ' '.repeat(config.bytesPerLine*4+13); // lines2의 i번째 라인 또는 빈 문자열
        combinedLines.push(`${line1}  |  ${line2}`);
    }
    return [combinedLines.join('\n'),maxLines];
}

let startTime: number;
export const docProvider = new class implements vscode.TextDocumentContentProvider {
    onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri>();
    onDidChange = this.onDidChangeEmitter.event;
    provideTextDocumentContent(uri: vscode.Uri): string {
        // console.log(`show mid: ${performance.now()-startTime} ms`);


        const path0 = decodeURIComponent(uri.query);
        const path1 = decodeURIComponent(uri.fragment);
        const binary0 = readFileToUint8Array(path0);
        const binary1 = readFileToUint8Array(path1);
        const diffRanges = findBinaryDifferentRanges(binary0, binary1);
        let xxdRanges:[Range, Range[]][];
        const isContrastMode = config.isContrastMode|| (Math.max(binary0.length,binary1.length) > config.sizeContrast) ;
        if(isContrastMode) {
            const endLimit = Math.ceil((Math.min(binary0.length,binary1.length)+config.sizeContext)/config.bytesPerLine)*config.bytesPerLine;
            diffRanges[diffRanges.length-1].end = Math.min(diffRanges[diffRanges.length-1].end,endLimit);
            xxdRanges = mergeRanges(diffRanges, endLimit);
        } else {
            xxdRanges = [[{start:0,end:Math.max(binary0.length,binary1.length)},diffRanges]];
        }
        let contents = "";
        let displayLine = 0;
        let displaySize = 0;
        diffRangesIndex = [];
        diffRangesDisplay = [];
        for(const [xxdRange_,sourceRanges] of xxdRanges){
            let xxdRange = xxdRange_;
            const nextSize = displaySize + xxdRange.end - xxdRange.start;
            if( nextSize > config.sizeContrastDisplay) {
                xxdRange.end -= config.sizeContrastDisplay - displaySize;
            }
            const xxd0 = uint8ArrayToXxd(binary0,xxdRange.start,xxdRange.end);
            const xxd1 = uint8ArrayToXxd(binary1,xxdRange.start,xxdRange.end);
            const [xxdCombined, xxdLine] = combineLines(xxd0, xxd1);
            contents += xxdCombined+'\n\n';
            const [rangesIndex, rangesDisplay] = convertToVscodeRanges(sourceRanges,xxdRange.start,displayLine);
            diffRangesIndex = [...diffRangesIndex,...rangesIndex];
            diffRangesDisplay = [...diffRangesDisplay,...rangesDisplay];
            displaySize += xxdRange.end - xxdRange.start;
            displayLine += xxdLine+1;
            if( nextSize > config.sizeContrastDisplay) {
                break;
            }

        }
        // console.log(`read time: ${performance.now()-startTime} ms`);
        // console.log(`xxd time: ${performance.now()-startTime} ms`);


        diffRangesIndexReverse = [...diffRangesIndex].reverse();

        //  contents = combineLines(xxd0, xxd1);



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
    updateConfiguration();


    const path0 = file[1][0].fsPath;
    const path1 = file[1][1].fsPath;
    const size0 = getFileSize(path0);
    const size1 = getFileSize(path1);
    if (size0 > config.sizeContrast || size1 > config.sizeContrast ) {
        vscode.window.showInformationMessage('File is too large, open with contrast mode.');
    }

    const uriPath0 = encodeURIComponent(path0);
    const uriPath1 = encodeURIComponent(path1);
    const title = `${path0} ↔ ${path.basename(path1)} `;
    // const title = `${path0} ↔ ${path1} `;

    // console.log(`combine time: ${performance.now()-startTime} ms`);
    const hexdiffUri = vscode.Uri.from({scheme:scheme, path:title, query:uriPath0, fragment:uriPath1});
    // console.log(`show start: ${performance.now()-startTime} ms`);
    diffViewer = await vscode.window.showTextDocument(hexdiffUri);
    // console.log(`show time: ${performance.now()-startTime} ms`);

    if (diffRangesDisplay.length) {
        await diffViewer.setDecorations(vscode.window.createTextEditorDecorationType({
            backgroundColor: config.backgroundColor,
            overviewRulerColor: config.overviewRulerColor
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
    const lineText = event.textEditor.document.lineAt(currentSelection.line).text;
    const address = parseInt(lineText.split(/(\:)/)[0],16);
    let bytePosition: number;
    switch (true) {
        case currentSelection.character >= 0 && currentSelection.character < offsetLeft + offsetChar - 1:
            bytePosition = Math.max(0, Math.min(Math.floor((currentSelection.character - offsetLeft) / 3), config.bytesPerLine - 1));
            break;
        case currentSelection.character >= offsetLeft + offsetChar - 1 && currentSelection.character < offsetLeft + offsetChar + config.bytesPerLine + 3:
            bytePosition = Math.max(0, Math.min(Math.floor((currentSelection.character - (offsetLeft + offsetChar))), config.bytesPerLine - 1));
            break;
        case currentSelection.character >= offsetLeft + offsetChar + config.bytesPerLine + 3 && currentSelection.character < offsetRight + offsetChar - 1:
            bytePosition = Math.max(0, Math.min(Math.floor((currentSelection.character - (offsetRight)) / 3), config.bytesPerLine - 1));
            break;
        default:
            bytePosition = Math.max(0, Math.min(Math.floor((currentSelection.character - (offsetRight + offsetChar))), config.bytesPerLine - 1));
            break;
    }
    const currentPosition = address + bytePosition;
    if (!isNaN(currentPosition))    positionStatusBar.text = `Hexdiff Position: ${currentPosition}(0x${currentPosition.toString(16).toUpperCase()})`;
}


