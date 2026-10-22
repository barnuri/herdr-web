import { describe, expect, it } from 'vitest';
import { mirrorChar, visualOrder } from './bidi-reorder';

function visual(text: string): string {
    const chars = [...text];
    return visualOrder(chars).map((index) => chars[index]).join('');
}

describe('visualOrder', () => {
    it('reverses an RTL run so its first character lands in the rightmost cell', () => {
        expect(visual('שלום עולם')).toBe('םלוע םולש');
    });

    it('keeps numbers left-to-right inside the run', () => {
        expect(visual('שלום 123 עולם')).toBe('םלוע 123 םולש');
    });

    it('keeps separators that join digits inside the number', () => {
        expect(visual('א 1,000 ב')).toBe('ב 1,000 א');
        expect(visual('א 12:30 ב')).toBe('ב 12:30 א');
    });

    it('treats a separator that does not join digits as a neutral', () => {
        expect(visual('א 12, ב')).toBe('ב ,12 א');
    });

    it('orders separate numbers right-to-left', () => {
        expect(visual('א 12 34 ב')).toBe('ב 34 12 א');
    });

    it('maps every logical index exactly once, for any length', () => {
        const chars = [...'ש'.repeat(200)];
        const order = visualOrder(chars);
        expect(order).toHaveLength(200);
        expect(order[0]).toBe(199);
        expect(order[199]).toBe(0);
    });
});

describe('mirrorChar', () => {
    it('flips brackets and leaves other characters alone', () => {
        expect(mirrorChar('(')).toBe(')');
        expect(mirrorChar(']')).toBe('[');
        expect(mirrorChar('ש')).toBe('ש');
    });
});
