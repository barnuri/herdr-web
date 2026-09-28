import { describe, expect, it } from 'vitest';
import {
    FLING_MAX_DURATION_MS,
    FLING_MAX_VELOCITY,
    ScrollFling,
    planScroll,
} from './scroll-planner';

describe('planScroll', () => {
    it('waits for a full cell height before producing a line', () => {
        const first = planScroll(5, 16, 0);
        expect(first.lines).toBe(0);
        expect(first.remainder).toBe(5);

        const second = planScroll(7, 16, first.remainder);
        expect(second.lines).toBe(0);
        expect(second.remainder).toBe(12);

        const third = planScroll(5, 16, second.remainder);
        expect(third.lines).toBe(1);
        expect(third.remainder).toBe(1);
    });

    it('produces multiple lines for a fast swipe', () => {
        const plan = planScroll(40, 16, 0);
        expect(plan.lines).toBe(2);
        expect(plan.remainder).toBe(8);
    });

    it('mirrors the direction for downward drags', () => {
        const plan = planScroll(-40, 16, 0);
        expect(plan.lines).toBe(-2);
        expect(plan.remainder).toBe(-8);
    });

    it('drops the leftover when the drag reverses', () => {
        // 12px of a downward gesture left over, then the finger turns around
        const plan = planScroll(-6, 16, 12);
        expect(plan.lines).toBe(0);
        expect(plan.remainder).toBe(-6);
    });

    it('keeps the leftover through a stationary move', () => {
        // the browser still sends touchmove (delta 0) while the finger rests; the remainder must not be dropped as a reversal
        const plan = planScroll(0, 16, 12);
        expect(plan.lines).toBe(0);
        expect(plan.remainder).toBe(12);

        const next = planScroll(4, 16, plan.remainder);
        expect(next.lines).toBe(1);
        expect(next.remainder).toBe(0);
    });

    it('caps a single move and carries the excess to the next one', () => {
        const plan = planScroll(100, 16, 0);
        expect(plan.lines).toBe(3);
        // 100 - 48 = 52 stays, clamped to three cells at most
        expect(plan.remainder).toBe(48);

        const next = planScroll(1, 16, plan.remainder);
        expect(next.lines).toBe(3);
    });

    it('falls back to a sane cell height for degenerate input', () => {
        const plan = planScroll(20, 0, 0);
        expect(plan.lines).toBe(1);
        expect(plan.remainder).toBe(4);
    });
});

describe('ScrollFling', () => {
    it('refuses to start below the release-velocity threshold', () => {
        const fling = new ScrollFling(0.05);
        expect(fling.active).toBe(false);
        expect(fling.step(16)).toBe(0);
    });

    it('moves in the release direction and decays towards a stop', () => {
        const fling = new ScrollFling(1);
        let previous = Infinity;
        let total = 0;
        let steps = 0;
        while (fling.active && steps < 1000) {
            const distance = fling.step(16);
            expect(distance).toBeGreaterThan(0);
            expect(distance).toBeLessThan(previous);
            previous = distance;
            total += distance;
            steps += 1;
        }
        expect(fling.active).toBe(false);
        // v0 / -ln(decay) ≈ 333px of travel for a 1px/ms release
        expect(total).toBeGreaterThan(300);
        expect(total).toBeLessThan(360);
    });

    it('keeps the sign for downward (older-content) flings', () => {
        const fling = new ScrollFling(-1);
        expect(fling.step(16)).toBeLessThan(0);
    });

    it('clamps an implausibly fast release to the velocity cap', () => {
        const fast = new ScrollFling(1000);
        const capped = new ScrollFling(FLING_MAX_VELOCITY);
        expect(fast.step(16)).toBeCloseTo(capped.step(16), 10);
    });

    it('never travels further than the duration cap allows', () => {
        const fling = new ScrollFling(FLING_MAX_VELOCITY);
        let total = 0;
        let elapsed = 0;
        while (fling.active && elapsed <= FLING_MAX_DURATION_MS + 100) {
            total += fling.step(16);
            elapsed += 16;
        }
        expect(elapsed).toBeLessThanOrEqual(FLING_MAX_DURATION_MS + 16);
        // v0 / -ln(decay) ≈ 1331px; the duration cap must not let it run away past that
        expect(total).toBeLessThan(1400);
    });

    it('ignores a non-positive time step', () => {
        const fling = new ScrollFling(1);
        expect(fling.step(0)).toBe(0);
        expect(fling.step(-5)).toBe(0);
        expect(fling.active).toBe(true);
    });

    it('stops immediately when a boundary is reached', () => {
        const fling = new ScrollFling(1);
        fling.stop();
        expect(fling.active).toBe(false);
        expect(fling.step(16)).toBe(0);
    });
});
