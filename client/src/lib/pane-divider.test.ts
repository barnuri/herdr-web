import { describe, expect, it } from 'vitest';
import { findDividerCell, findVerticalDividerCell } from './pane-divider';

// a 10x5 grid: a vertical divider in column 5 and plain text elsewhere
function gridWithVerticalDivider(col = 5): (c: number, r: number) => string {
    return (c) => (c === col ? '│' : c % 2 === 0 ? 'x' : '');
}

describe('findDividerCell', () => {
    it('returns the touched cell when it is a divider glyph', () => {
        expect(findDividerCell(gridWithVerticalDivider(), 10, 5, { col: 5, row: 2 })).toEqual({ col: 5, row: 2 });
    });

    it('finds a divider one cell away, so a finger does not have to be exact', () => {
        expect(findDividerCell(gridWithVerticalDivider(), 10, 5, { col: 4, row: 2 })).toEqual({ col: 5, row: 2 });
        expect(findDividerCell(gridWithVerticalDivider(), 10, 5, { col: 6, row: 2 })).toEqual({ col: 5, row: 2 });
    });

    it('returns null on plain text far from any divider', () => {
        expect(findDividerCell(gridWithVerticalDivider(), 10, 5, { col: 0, row: 2 })).toBeNull();
    });

    it('does not look past the grid edges', () => {
        const topLeftCorner = () => '';
        expect(findDividerCell(topLeftCorner, 10, 5, { col: 0, row: 0 })).toBeNull();
    });

    it('recognises horizontal dividers too', () => {
        const horizontal = (_c: number, r: number) => (r === 3 ? '─' : '');
        expect(findDividerCell(horizontal, 10, 5, { col: 4, row: 3 })).toEqual({ col: 4, row: 3 });
        expect(findDividerCell(horizontal, 10, 5, { col: 4, row: 2 })).toEqual({ col: 4, row: 3 });
    });
});

describe('findVerticalDividerCell', () => {
    const tall = (c: number) => (c === 5 ? '│' : 'x');

    it('grabs a tall vertical border without any toggle', () => {
        expect(findVerticalDividerCell(tall, 10, 20, { col: 5, row: 7 })).toEqual({ col: 5, row: 7 });
        expect(findVerticalDividerCell(tall, 10, 20, { col: 6, row: 7 })).toEqual({ col: 5, row: 7 });
    });

    it('ignores a short box edge a TUI draws', () => {
        const shortBox = (c: number, r: number) => (c === 5 && r >= 8 && r <= 10 ? '│' : 'x');
        expect(findVerticalDividerCell(shortBox, 10, 20, { col: 5, row: 9 })).toBeNull();
    });

    it('never matches a horizontal rule', () => {
        const rule = (_c: number, r: number) => (r === 3 ? '─' : 'x');
        expect(findVerticalDividerCell(rule, 10, 20, { col: 4, row: 3 })).toBeNull();
    });

    it('returns null away from the border', () => {
        expect(findVerticalDividerCell(tall, 10, 20, { col: 1, row: 7 })).toBeNull();
    });
});
