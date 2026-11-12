import type { KittyBitmap, KittyVisibleFrame } from './types';

export interface KittyCellSize {
    readonly width: number;
    readonly height: number;
}

// draws kitty frames on a canvas laid over xterm's own screen element. It shares that
// element's coordinate space, so a placement's cell position maps straight to pixels.
export class KittyOverlayRenderer {
    private static readonly CLASS_NAME = 'kitty-overlay';

    private readonly canvas: HTMLCanvasElement;

    constructor(private readonly screen: HTMLElement) {
        this.canvas = screen.ownerDocument.createElement('canvas');
        this.canvas.className = KittyOverlayRenderer.CLASS_NAME;
        screen.appendChild(this.canvas);
    }

    render(
        frames: readonly KittyVisibleFrame[],
        resolveBitmap: (imageId: number) => KittyBitmap | undefined,
        cell: KittyCellSize,
    ): void {
        const context = this.resizeToScreen();
        if (context === null) {
            return;
        }
        context.clearRect(0, 0, this.screen.clientWidth, this.screen.clientHeight);
        // frames are scaled to the cell grid, so smooth them instead of leaving hard pixel edges
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = 'high';
        for (const frame of frames) {
            const bitmap = resolveBitmap(frame.imageId);
            if (bitmap === undefined) {
                continue;
            }
            context.drawImage(
                bitmap.source,
                frame.col * cell.width,
                frame.screenRow * cell.height,
                frame.cols * cell.width,
                frame.rows * cell.height,
            );
        }
    }

    dispose(): void {
        this.canvas.remove();
    }

    // keeps the backing store at device resolution while the canvas stays CSS-sized to the grid
    private resizeToScreen(): CanvasRenderingContext2D | null {
        const cssWidth = this.screen.clientWidth;
        const cssHeight = this.screen.clientHeight;
        if (cssWidth === 0 || cssHeight === 0) {
            return null;
        }
        const ratio = this.screen.ownerDocument.defaultView?.devicePixelRatio ?? 1;
        const deviceWidth = Math.round(cssWidth * ratio);
        const deviceHeight = Math.round(cssHeight * ratio);
        if (this.canvas.width !== deviceWidth || this.canvas.height !== deviceHeight) {
            this.canvas.width = deviceWidth;
            this.canvas.height = deviceHeight;
        }
        this.canvas.style.width = `${cssWidth}px`;
        this.canvas.style.height = `${cssHeight}px`;
        const context = this.canvas.getContext('2d');
        if (context === null) {
            return null;
        }
        context.setTransform(ratio, 0, 0, ratio, 0, 0);
        return context;
    }
}
