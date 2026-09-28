import { describe, expect, it } from 'vitest';
import { nextViewportLayout } from './viewport-offset';

const PHONE_WIDTH = 400;
const FULL_HEIGHT = 800;
const KEYBOARD_HEIGHT = 300;

const closed = { width: PHONE_WIDTH, height: FULL_HEIGHT, offsetTop: 0 };

describe('nextViewportLayout', () => {
    it('starts from the first sample with no offset', () => {
        expect(nextViewportLayout(closed, null)).toEqual({ width: PHONE_WIDTH, fullHeight: FULL_HEIGHT, keyboardOffset: 0 });
    });

    it('keeps the full height and offsets by the keyboard height when it opens', () => {
        const open = nextViewportLayout({ ...closed, height: FULL_HEIGHT - KEYBOARD_HEIGHT }, nextViewportLayout(closed, null));
        expect(open).toEqual({ width: PHONE_WIDTH, fullHeight: FULL_HEIGHT, keyboardOffset: KEYBOARD_HEIGHT });
    });

    it('accounts for the browser panning the visual viewport down', () => {
        const pannedBy = 100;
        const open = nextViewportLayout(
            { width: PHONE_WIDTH, height: FULL_HEIGHT - KEYBOARD_HEIGHT, offsetTop: pannedBy },
            nextViewportLayout(closed, null),
        );
        expect(open.keyboardOffset).toBe(KEYBOARD_HEIGHT - pannedBy);
    });

    it('returns to no offset when the keyboard closes', () => {
        const open = nextViewportLayout({ ...closed, height: FULL_HEIGHT - KEYBOARD_HEIGHT }, nextViewportLayout(closed, null));
        expect(nextViewportLayout(closed, open).keyboardOffset).toBe(0);
    });

    it('grows the full height when a taller viewport appears at the same width', () => {
        const start = nextViewportLayout({ ...closed, height: FULL_HEIGHT - 50 }, null);
        expect(nextViewportLayout(closed, start).fullHeight).toBe(FULL_HEIGHT);
    });

    it('starts over when the width changes', () => {
        const rotated = { width: FULL_HEIGHT, height: PHONE_WIDTH, offsetTop: 0 };
        expect(nextViewportLayout(rotated, nextViewportLayout(closed, null))).toEqual({
            width: FULL_HEIGHT,
            fullHeight: PHONE_WIDTH,
            keyboardOffset: 0,
        });
    });

    it('never offsets below zero', () => {
        const pannedPastBottom = { width: PHONE_WIDTH, height: FULL_HEIGHT, offsetTop: 40 };
        expect(nextViewportLayout(pannedPastBottom, nextViewportLayout(closed, null)).keyboardOffset).toBe(0);
    });
});
