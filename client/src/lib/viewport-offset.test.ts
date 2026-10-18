import { describe, expect, it } from 'vitest';
import { nextViewportLayout } from './viewport-offset';

const FULL_HEIGHT = 800;
const KEYBOARD_HEIGHT = 300;

describe('nextViewportLayout', () => {
    it('fills the full height with the keyboard closed', () => {
        expect(nextViewportLayout({ height: FULL_HEIGHT, offsetTop: 0 })).toEqual({ height: FULL_HEIGHT, top: 0 });
    });

    it('shrinks to the space above the keyboard when it opens', () => {
        expect(nextViewportLayout({ height: FULL_HEIGHT - KEYBOARD_HEIGHT, offsetTop: 0 })).toEqual({
            height: FULL_HEIGHT - KEYBOARD_HEIGHT,
            top: 0,
        });
    });

    it('follows the browser panning the visual viewport down', () => {
        expect(nextViewportLayout({ height: FULL_HEIGHT - KEYBOARD_HEIGHT, offsetTop: 100 }).top).toBe(100);
    });

    it('never goes negative', () => {
        expect(nextViewportLayout({ height: -1, offsetTop: -20 })).toEqual({ height: 0, top: 0 });
    });
});
