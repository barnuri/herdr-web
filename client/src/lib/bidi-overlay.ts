import type { IBufferCell, IBufferLine, IDisposable, ITheme, Terminal } from '@xterm/xterm';
import { findRtlRuns, hasRtl } from './bidi-runs';
import { mirrorChar, visualOrder } from './bidi-reorder';
import { paletteFromTheme, resolveCellStyle, type CellPalette, type CellStyle } from './cell-style';

interface CellGeometry {
    readonly context: CanvasRenderingContext2D;
    readonly cellWidth: number;
    readonly cellHeight: number;
    readonly pixelRatio: number;
}

const DIM_ALPHA = 0.5;

// xterm has no BiDi. This canvas sits over xterm's screen and repaints each RTL run in visual
// order, one glyph per cell, so a run of any length stays on the cell grid.
export class BidiOverlay {
    private static readonly CLASS_NAME = 'bidi-overlay';

    private readonly canvas: HTMLCanvasElement;
    private readonly disposables: IDisposable[];
    private readonly paintedRows = new Set<number>();
    private readonly advances = new Map<string, number>();
    private paletteTheme: ITheme | undefined;
    private palette: CellPalette = paletteFromTheme({});
    private workCell: IBufferCell | undefined;

    constructor(
        private readonly terminal: Terminal,
        private readonly screen: HTMLElement,
    ) {
        this.canvas = screen.ownerDocument.createElement('canvas');
        this.canvas.className = BidiOverlay.CLASS_NAME;
        screen.appendChild(this.canvas);
        this.disposables = [
            terminal.onRender(({ start, end }) => this.paintRows(start, end)),
            terminal.onResize(() => this.paintRows(0, terminal.rows - 1)),
        ];
        this.paintRows(0, terminal.rows - 1);
    }

    dispose(): void {
        for (const disposable of this.disposables) {
            disposable.dispose();
        }
        this.canvas.remove();
    }

    private paintRows(start: number, end: number): void {
        const resized = this.resizeToScreen();
        const context = this.canvas.getContext('2d');
        if (context === null || this.canvas.width === 0) {
            return;
        }
        const geometry: CellGeometry = {
            context,
            cellWidth: this.canvas.width / this.terminal.cols,
            cellHeight: this.canvas.height / this.terminal.rows,
            pixelRatio: this.screen.ownerDocument.defaultView?.devicePixelRatio ?? 1,
        };
        this.refreshPalette();
        const first = resized ? 0 : start;
        const last = resized ? this.terminal.rows - 1 : end;
        for (let row = first; row <= last; row++) {
            this.paintRow(row, geometry);
        }
    }

    private paintRow(row: number, geometry: CellGeometry): void {
        const top = row * geometry.cellHeight;
        if (this.paintedRows.delete(row)) {
            geometry.context.clearRect(0, top, this.canvas.width, geometry.cellHeight);
        }
        const buffer = this.terminal.buffer.active;
        const line = buffer.getLine(buffer.viewportY + row);
        if (line === undefined || !hasRtl(line.translateToString(true))) {
            return;
        }
        const chars = this.cellChars(line);
        const runs = findRtlRuns(chars);
        // the cursor's cell stays unpainted so xterm's own cursor shows through
        const cursorCol = buffer.baseY + buffer.cursorY === buffer.viewportY + row ? buffer.cursorX : -1;
        for (const [start, end] of runs) {
            this.paintRun(line, chars, start, end, top, cursorCol, geometry);
        }
        if (runs.length > 0) {
            this.paintedRows.add(row);
        }
    }

    private cellChars(line: IBufferLine): string[] {
        const chars: string[] = [];
        for (let col = 0; col < this.terminal.cols; col++) {
            const cell = this.cellAt(line, col);
            if (cell === undefined || cell.getWidth() === 0) {
                chars.push('');
                continue;
            }
            chars.push(cell.getChars() || ' ');
        }
        return chars;
    }

    private paintRun(
        line: IBufferLine,
        chars: readonly string[],
        start: number,
        end: number,
        top: number,
        cursorCol: number,
        geometry: CellGeometry,
    ): void {
        const order = visualOrder(chars.slice(start, end));
        const boldIsBright = this.terminal.options.drawBoldTextInBrightColors ?? true;
        order.forEach((logical, visual) => {
            const col = start + visual;
            const cell = this.cellAt(line, start + logical);
            if (col === cursorCol || cell === undefined) {
                return;
            }
            const style = resolveCellStyle(cell, this.palette, boldIsBright);
            this.paintCell(mirrorChar(chars[start + logical]), style, col * geometry.cellWidth, top, geometry);
        });
    }

    private paintCell(char: string, style: CellStyle, left: number, top: number, geometry: CellGeometry): void {
        const { context, cellWidth, cellHeight, pixelRatio } = geometry;
        context.globalAlpha = 1;
        context.fillStyle = style.background;
        context.fillRect(left, top, cellWidth, cellHeight);
        if (style.invisible) {
            return;
        }
        context.globalAlpha = style.dim ? DIM_ALPHA : 1;
        context.fillStyle = style.foreground;
        context.font = this.fontFor(style, pixelRatio);
        context.textBaseline = 'ideographic';
        const advance = this.advanceOf(context, char);
        const squeeze = advance > cellWidth ? cellWidth / advance : 1;
        context.save();
        context.translate(left, top + cellHeight);
        context.scale(squeeze, 1);
        context.fillText(char, 0, 0);
        context.restore();
        if (style.underline) {
            const thickness = Math.max(1, Math.floor(pixelRatio));
            context.fillRect(left, top + cellHeight - thickness, cellWidth, thickness);
        }
    }

    private fontFor(style: CellStyle, pixelRatio: number): string {
        const { fontFamily, fontSize, fontWeight, fontWeightBold } = this.terminal.options;
        const weight = style.bold ? (fontWeightBold ?? 'bold') : (fontWeight ?? 'normal');
        const slant = style.italic ? 'italic ' : '';
        return `${slant}${weight} ${(fontSize ?? 15) * pixelRatio}px ${fontFamily ?? 'monospace'}`;
    }

    private advanceOf(context: CanvasRenderingContext2D, char: string): number {
        const key = `${context.font}\u0000${char}`;
        let advance = this.advances.get(key);
        if (advance === undefined) {
            advance = context.measureText(char).width;
            this.advances.set(key, advance);
        }
        return advance;
    }

    private cellAt(line: IBufferLine, col: number): IBufferCell | undefined {
        const cell = line.getCell(col, this.workCell);
        this.workCell = cell ?? this.workCell;
        return cell;
    }

    private refreshPalette(): void {
        const theme = this.terminal.options.theme ?? {};
        if (theme !== this.paletteTheme) {
            this.paletteTheme = theme;
            this.palette = paletteFromTheme(theme);
        }
    }

    // keeps the backing store at device resolution, sized to the grid; a resize clears it
    private resizeToScreen(): boolean {
        const cssWidth = this.screen.clientWidth;
        const cssHeight = this.screen.clientHeight;
        const ratio = this.screen.ownerDocument.defaultView?.devicePixelRatio ?? 1;
        const deviceWidth = Math.round(cssWidth * ratio);
        const deviceHeight = Math.round(cssHeight * ratio);
        if (this.canvas.width === deviceWidth && this.canvas.height === deviceHeight) {
            return false;
        }
        this.canvas.width = deviceWidth;
        this.canvas.height = deviceHeight;
        this.canvas.style.width = `${cssWidth}px`;
        this.canvas.style.height = `${cssHeight}px`;
        this.paintedRows.clear();
        return true;
    }
}
