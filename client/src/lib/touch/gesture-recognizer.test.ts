import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TouchGestureRecognizer } from './gesture-recognizer';

function build() {
    const onScroll = vi.fn();
    const onLongPress = vi.fn();
    return { recognizer: new TouchGestureRecognizer({ onScroll, onLongPress }), onScroll, onLongPress };
}

describe('TouchGestureRecognizer', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('reports the upward drag distance and the current point as a scroll', () => {
        const { recognizer, onScroll } = build();
        recognizer.start({ x: 100, y: 400 });
        recognizer.move({ x: 100, y: 380 });
        expect(onScroll).toHaveBeenCalledWith(20, { x: 100, y: 380 });
    });

    it('reports a downward drag as a negative delta', () => {
        const { recognizer, onScroll } = build();
        recognizer.start({ x: 100, y: 400 });
        recognizer.move({ x: 100, y: 415 });
        expect(onScroll).toHaveBeenCalledWith(-15, { x: 100, y: 415 });
    });

    it('measures each delta against the previous point, not the origin', () => {
        const { recognizer, onScroll } = build();
        recognizer.start({ x: 0, y: 300 });
        recognizer.move({ x: 0, y: 290 });
        recognizer.move({ x: 0, y: 275 });
        expect(onScroll.mock.calls.map((call) => call[0])).toEqual([10, 15]);
    });

    it('fires a long press at the touch origin after the hold delay', () => {
        const { recognizer, onLongPress } = build();
        recognizer.start({ x: 42, y: 99 });
        vi.advanceTimersByTime(500);
        expect(onLongPress).toHaveBeenCalledWith({ x: 42, y: 99 });
        expect(recognizer.didLongPress).toBe(true);
    });

    it('does not fire a long press before the hold delay elapses', () => {
        const { recognizer, onLongPress } = build();
        recognizer.start({ x: 42, y: 99 });
        vi.advanceTimersByTime(499);
        expect(onLongPress).not.toHaveBeenCalled();
    });

    it('cancels the long press once the finger travels beyond the slop threshold', () => {
        const { recognizer, onLongPress } = build();
        recognizer.start({ x: 100, y: 100 });
        recognizer.move({ x: 100, y: 85 });
        vi.advanceTimersByTime(1000);
        expect(onLongPress).not.toHaveBeenCalled();
    });

    it('keeps the long press armed through jitter inside the slop threshold', () => {
        const { recognizer, onLongPress } = build();
        recognizer.start({ x: 100, y: 100 });
        recognizer.move({ x: 102, y: 103 });
        vi.advanceTimersByTime(500);
        expect(onLongPress).toHaveBeenCalledTimes(1);
    });

    it('stops scrolling for the rest of a gesture once the long press fires', () => {
        const { recognizer, onScroll } = build();
        recognizer.start({ x: 100, y: 400 });
        vi.advanceTimersByTime(500);
        expect(recognizer.move({ x: 100, y: 340 })).toBe(true);
        expect(onScroll).not.toHaveBeenCalled();
    });

    it('cancels a pending long press when the finger lifts', () => {
        const { recognizer, onLongPress } = build();
        recognizer.start({ x: 1, y: 1 });
        recognizer.end();
        vi.advanceTimersByTime(1000);
        expect(onLongPress).not.toHaveBeenCalled();
    });

    it('ignores a move that arrives without a preceding start', () => {
        const { recognizer, onScroll } = build();
        expect(recognizer.move({ x: 5, y: 5 })).toBe(false);
        expect(onScroll).not.toHaveBeenCalled();
    });

    it('clears the long-press flag when the next gesture begins', () => {
        const { recognizer } = build();
        recognizer.start({ x: 1, y: 1 });
        vi.advanceTimersByTime(500);
        recognizer.end();
        recognizer.start({ x: 1, y: 1 });
        expect(recognizer.didLongPress).toBe(false);
    });

    it('clears the long-press flag as soon as the gesture ends', () => {
        const { recognizer } = build();
        recognizer.start({ x: 1, y: 1 });
        vi.advanceTimersByTime(500);
        expect(recognizer.didLongPress).toBe(true);
        recognizer.end();
        expect(recognizer.didLongPress).toBe(false);
    });
});

describe('TouchGestureRecognizer release velocity', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('reports the release velocity of an upward flick', () => {
        const { recognizer } = build();
        recognizer.start({ x: 0, y: 400 });
        vi.advanceTimersByTime(50);
        recognizer.move({ x: 0, y: 380 });
        vi.advanceTimersByTime(50);
        recognizer.move({ x: 0, y: 350 });
        // (400 - 350)px over 100ms
        expect(recognizer.end()).toBeCloseTo(0.5, 10);
    });

    it('reports a downward flick as a negative velocity', () => {
        const { recognizer } = build();
        recognizer.start({ x: 0, y: 300 });
        vi.advanceTimersByTime(20);
        recognizer.move({ x: 0, y: 320 });
        expect(recognizer.end()).toBeCloseTo(-1, 10);
    });

    it('reports no velocity when the finger pauses before lifting', () => {
        const { recognizer } = build();
        recognizer.start({ x: 0, y: 400 });
        vi.advanceTimersByTime(20);
        recognizer.move({ x: 0, y: 340 });
        // 300ms pause pushes the moving sample out of the velocity window
        vi.advanceTimersByTime(300);
        recognizer.move({ x: 0, y: 340 });
        expect(recognizer.end()).toBe(0);
    });

    it('reports no velocity for a tap that never leaves the slop radius', () => {
        const { recognizer } = build();
        recognizer.start({ x: 0, y: 400 });
        vi.advanceTimersByTime(30);
        recognizer.move({ x: 1, y: 401 });
        expect(recognizer.end()).toBe(0);
    });

    it('reports no velocity once a long press has fired', () => {
        const { recognizer } = build();
        recognizer.start({ x: 0, y: 400 });
        vi.advanceTimersByTime(500);
        recognizer.move({ x: 0, y: 300 });
        expect(recognizer.end()).toBe(0);
    });

    it('reports the flick speed after a stationary pause inside the window', () => {
        const { recognizer } = build();
        recognizer.start({ x: 0, y: 400 });
        vi.advanceTimersByTime(300);
        recognizer.move({ x: 0, y: 400 });
        vi.advanceTimersByTime(50);
        recognizer.move({ x: 0, y: 350 });
        expect(recognizer.end()).toBeCloseTo(1, 10);
    });

    it('does not leak velocity into the next gesture', () => {
        const { recognizer } = build();
        recognizer.start({ x: 0, y: 400 });
        vi.advanceTimersByTime(20);
        recognizer.move({ x: 0, y: 300 });
        expect(recognizer.end()).not.toBe(0);
        recognizer.start({ x: 0, y: 400 });
        expect(recognizer.end()).toBe(0);
    });

    it('reports no velocity when the finger stops moving before lifting', () => {
        const { recognizer } = build();
        recognizer.start({ x: 0, y: 400 });
        vi.advanceTimersByTime(20);
        recognizer.move({ x: 0, y: 320 });
        // no further touchmove while the finger rests, then the lift arrives much later
        vi.advanceTimersByTime(300);
        expect(recognizer.end()).toBe(0);
    });
});
