// herdr draws the borders between panes with box-drawing glyphs (U+2500–U+257F), and resizes a
// split when the mouse drags one of them. A finger is far less precise than a mouse, so a
// touch counts as "on a divider" when a box-drawing glyph sits in the touched cell or next to it.
const BOX_DRAWING = /[\u2500-\u257F]/;

export interface CellPosition {
    readonly col: number;
    readonly row: number;
}

/**
 * Finds the divider cell nearest to a touched cell.
 *
 * `charAt` returns the glyph drawn in a cell ('' when empty). The touched cell is checked first,
 * then its eight neighbours, so a finger that lands a cell off the thin line still grabs it.
 * Returns null when no box-drawing glyph is nearby.
 */
export function findDividerCell(
    charAt: (col: number, row: number) => string,
    cols: number,
    rows: number,
    touched: CellPosition,
): CellPosition | null {
    const offsets: readonly CellPosition[] = [
        { col: 0, row: 0 },
        { col: -1, row: 0 },
        { col: 1, row: 0 },
        { col: 0, row: -1 },
        { col: 0, row: 1 },
        { col: -1, row: -1 },
        { col: 1, row: -1 },
        { col: -1, row: 1 },
        { col: 1, row: 1 },
    ];
    for (const offset of offsets) {
        const col = touched.col + offset.col;
        const row = touched.row + offset.row;
        if (col < 0 || row < 0 || col >= cols || row >= rows) {
            continue;
        }
        if (BOX_DRAWING.test(charAt(col, row))) {
            return { col, row };
        }
    }
    return null;
}

const VERTICAL_LINE = /[\u2502\u2503\u2551\u254E\u254F\u2506\u2507\u250A\u250B]/;
// a pane split runs most of the way down the screen; a box a TUI draws around its own input does not
const MIN_VERTICAL_RUN_RATIO = 0.5;

/**
 * Finds a vertical pane border under a touch without any toggle: the touched column (or one
 * either side) must hold a tall unbroken run of vertical line glyphs through the touched row.
 * Horizontal lines are never matched here, since TUIs draw their own full-width rules.
 */
export function findVerticalDividerCell(
    charAt: (col: number, row: number) => string,
    cols: number,
    rows: number,
    touched: CellPosition,
): CellPosition | null {
    if (touched.row < 0 || touched.row >= rows) {
        return null;
    }
    const minRun = Math.max(3, Math.ceil(rows * MIN_VERTICAL_RUN_RATIO));
    for (const offset of [0, -1, 1]) {
        const col = touched.col + offset;
        if (col < 0 || col >= cols || !VERTICAL_LINE.test(charAt(col, touched.row))) {
            continue;
        }
        let top = touched.row;
        while (top > 0 && VERTICAL_LINE.test(charAt(col, top - 1))) {
            top -= 1;
        }
        let bottom = touched.row;
        while (bottom < rows - 1 && VERTICAL_LINE.test(charAt(col, bottom + 1))) {
            bottom += 1;
        }
        if (bottom - top + 1 >= minRun) {
            return { col, row: touched.row };
        }
    }
    return null;
}
