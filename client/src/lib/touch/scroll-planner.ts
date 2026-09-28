// xterm's pixel-mode wheel handling scales small moves down (under 50px counts at 30%) and rounds
// to whole lines, while each touch drag move is only a few pixels, so most movement is lost and
// the terminal lags the finger. Here pixel movement is converted to whole lines and dispatched in
// line mode (DOM_DELTA_LINE), which xterm does not scale.
export const SCROLL_MAX_NOTCHES = 3;

// Inertia parameters (kept here for tuning). Velocity is in px/ms with the same sign as onScroll's deltaY:
// positive = finger moved up = newer content.
/** No inertia below this release velocity, so a slow drag does not drift after release */
export const FLING_MIN_VELOCITY = 0.15;
/** Release velocity cap, so one fling cannot fly too far */
export const FLING_MAX_VELOCITY = 4;
/** Fraction of velocity kept per millisecond (exponential damping, close to native scroll inertia) */
export const FLING_DECAY_PER_MS = 0.997;
/** Stop once velocity decays below this */
export const FLING_STOP_VELOCITY = 0.02;
/** Maximum inertia duration (ms), a backstop against endless scrolling with low decay */
export const FLING_MAX_DURATION_MS = 1500;
/** Maximum time step per frame (ms): a pause from backgrounding must not count as decay */
export const FLING_MAX_FRAME_MS = 32;

export interface ScrollPlan {
    /** Lines to apply now; the sign is the direction (positive = down / newer content) */
    readonly lines: number;
    /** Pixel remainder under one line, carried to the next move */
    readonly remainder: number;
}

export function planScroll(
    deltaY: number,
    cellHeight: number,
    remainder: number,
    maxNotches = SCROLL_MAX_NOTCHES,
): ScrollPlan {
    const height = cellHeight > 0 ? cellHeight : 16;
    // drop the old remainder when the drag reverses, or it would first pay it back before reversing;
    // a deltaY of 0 (a resting finger also fires touchmove) is not a reversal, so keep the remainder,
    // or every pause would reset the accumulated movement
    const reversed = deltaY !== 0 && remainder !== 0 && Math.sign(deltaY) !== Math.sign(remainder);
    const carried = reversed ? 0 : remainder;
    const pending = carried + deltaY;
    const rawLines = Math.trunc(pending / height);
    // normalize -0: Math.trunc returns -0 for small negatives and Object.is(-0, 0) is false, which would mislead callers
    const clamped = Math.max(-maxNotches, Math.min(maxNotches, rawLines));
    const lines = clamped === 0 ? 0 : clamped;
    const clamp = height * maxNotches;
    const rest = pending - lines * height;
    return { lines, remainder: Math.max(-clamp, Math.min(clamp, rest)) };
}

// Inertia after release: exponential damping turns the release velocity into pixel movement, and
// the caller calls step() once per frame. Pure math with no DOM or clock, so the decay curve and
// stop conditions are pinned by unit tests.
export class ScrollFling {
    private velocity: number;

    private elapsedMs = 0;

    constructor(releaseVelocity: number) {
        const clamped = Math.max(-FLING_MAX_VELOCITY, Math.min(FLING_MAX_VELOCITY, releaseVelocity));
        this.velocity = Math.abs(clamped) < FLING_MIN_VELOCITY ? 0 : clamped;
    }

    /** True while there is movement left; once false the caller should stop stepping */
    get active(): boolean {
        return this.velocity !== 0;
    }

    /**
     * Advances dtMs milliseconds and returns the pixels to scroll for that span.
     * Uses trapezoidal integration (mean of start and end velocity × time), closer to real deceleration than sampling the end velocity.
     */
    step(dtMs: number): number {
        if (!this.active || dtMs <= 0) {
            return 0;
        }
        const dt = Math.min(dtMs, FLING_MAX_DURATION_MS - this.elapsedMs);
        if (dt <= 0) {
            this.velocity = 0;
            return 0;
        }
        this.elapsedMs += dt;
        const next = this.velocity * FLING_DECAY_PER_MS ** dt;
        const distance = ((this.velocity + next) / 2) * dt;
        // below the stop threshold after decay, or past the duration cap: finish this step and stop
        this.velocity =
            Math.abs(next) < FLING_STOP_VELOCITY || this.elapsedMs >= FLING_MAX_DURATION_MS ? 0 : next;
        return distance;
    }

    /** Ends early at a bound or when the gesture is interrupted */
    stop(): void {
        this.velocity = 0;
    }
}
