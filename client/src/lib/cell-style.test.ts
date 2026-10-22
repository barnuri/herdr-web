import { describe, expect, it } from 'vitest';
import { paletteFromTheme, resolveCellStyle, type CellAttributes } from './cell-style';

const DEFAULT = 0;
const PALETTE = 1;
const RGB = 2;

interface FakeCell {
    fgMode?: number;
    fg?: number;
    bgMode?: number;
    bg?: number;
    bold?: boolean;
    inverse?: boolean;
    dim?: boolean;
    invisible?: boolean;
}

function cell(spec: FakeCell): CellAttributes {
    const flag = (on: boolean | undefined) => (on ? 1 : 0);
    return {
        isBold: () => flag(spec.bold),
        isItalic: () => 0,
        isDim: () => flag(spec.dim),
        isInverse: () => flag(spec.inverse),
        isInvisible: () => flag(spec.invisible),
        isUnderline: () => 0,
        isFgDefault: () => (spec.fgMode ?? DEFAULT) === DEFAULT,
        isFgPalette: () => spec.fgMode === PALETTE,
        isBgDefault: () => (spec.bgMode ?? DEFAULT) === DEFAULT,
        isBgPalette: () => spec.bgMode === PALETTE,
        getFgColor: () => spec.fg ?? 0,
        getBgColor: () => spec.bg ?? 0,
    };
}

const palette = paletteFromTheme({ foreground: '#e8eef2', background: '#050607' });

describe('paletteFromTheme', () => {
    it('builds the 256 xterm colors, with theme overrides for the first 16', () => {
        const themed = paletteFromTheme({ red: '#ff0000' });
        expect(themed.ansi).toHaveLength(256);
        expect(themed.ansi[1]).toBe('#ff0000');
        expect(themed.ansi[2]).toBe('#4e9a06');
        expect(themed.ansi[16]).toBe('#000000');
        expect(themed.ansi[21]).toBe('#0000ff');
        expect(themed.ansi[231]).toBe('#ffffff');
        expect(themed.ansi[232]).toBe('#080808');
        expect(themed.foreground).toBe('#ffffff');
    });
});

describe('resolveCellStyle', () => {
    it('uses the theme colors for default cells', () => {
        const style = resolveCellStyle(cell({}), palette, true);
        expect(style.foreground).toBe('#e8eef2');
        expect(style.background).toBe('#050607');
    });

    it('resolves palette and true-color cells', () => {
        const style = resolveCellStyle(cell({ fgMode: PALETTE, fg: 2, bgMode: RGB, bg: 0x123456 }), palette, true);
        expect(style.foreground).toBe('#4e9a06');
        expect(style.background).toBe('#123456');
    });

    it('brightens bold low palette colors only when asked', () => {
        const bold = cell({ fgMode: PALETTE, fg: 1, bold: true });
        expect(resolveCellStyle(bold, palette, true).foreground).toBe('#ef2929');
        expect(resolveCellStyle(bold, palette, false).foreground).toBe('#cc0000');
    });

    it('swaps colors for inverse cells', () => {
        const style = resolveCellStyle(cell({ inverse: true, bgMode: PALETTE, bg: 4 }), palette, true);
        expect(style.foreground).toBe('#3465a4');
        expect(style.background).toBe('#e8eef2');
    });

    it('reports dim and invisible cells', () => {
        const style = resolveCellStyle(cell({ dim: true, invisible: true }), palette, true);
        expect(style.dim).toBe(true);
        expect(style.invisible).toBe(true);
    });
});
