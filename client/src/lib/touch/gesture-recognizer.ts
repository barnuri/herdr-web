export interface TouchPoint {
    readonly x: number;
    readonly y: number;
}

export interface TouchGestureHandlers {
    readonly onScroll: (deltaY: number, point: TouchPoint) => void;
    readonly onLongPress: (point: TouchPoint) => void;
}

// arbitrates the two single-finger gestures the terminal supports: a drag scrolls, and a
// stationary hold is the touch equivalent of a right click. Kept free of DOM types so the
// thresholds and the scroll-vs-press decision stay unit-testable.
export class TouchGestureRecognizer {
    private static readonly LONG_PRESS_MS = 500;

    private static readonly MOVE_SLOP_PX = 10;

    // 末速度只取最近一小段窗口：手指停住再抬起时，窗口内速度自然归零，
    // 不会用整段拖动的平均值误触发惯性
    private static readonly VELOCITY_WINDOW_MS = 100;

    private static readonly MAX_VELOCITY_SAMPLES = 8;

    private origin: TouchPoint | null = null;

    private last: TouchPoint | null = null;

    private timer: ReturnType<typeof setTimeout> | null = null;

    private pressed = false;

    private scrolled = false;

    private samples: { readonly t: number; readonly y: number }[] = [];

    constructor(private readonly handlers: TouchGestureHandlers) {}

    // true while the browser's own contextmenu for this gesture should be swallowed
    get didLongPress(): boolean {
        return this.pressed;
    }

    start(point: TouchPoint): void {
        this.origin = point;
        this.last = point;
        this.pressed = false;
        this.scrolled = false;
        this.samples = [{ t: Date.now(), y: point.y }];
        this.timer = setTimeout(() => {
            this.timer = null;
            this.pressed = true;
            this.handlers.onLongPress(point);
        }, TouchGestureRecognizer.LONG_PRESS_MS);
    }

    // returns whether the move was consumed as a terminal gesture and should not also
    // drive the browser's native panning
    move(point: TouchPoint): boolean {
        if (this.origin === null || this.last === null) {
            return false;
        }
        if (this.movedBeyondSlop(point)) {
            this.disarmLongPress();
            this.scrolled = true;
        }
        this.record(point);
        const deltaY = this.last.y - point.y;
        this.last = point;
        if (this.pressed) {
            return true;
        }
        this.handlers.onScroll(deltaY, point);
        return true;
    }

    /**
     * 手势结束，返回松手时的末速度（px/ms，正 = 手指上滑 = 看更新的内容）。
     * 长按（已转成右键）、点击或窗口内没有有效时间跨度时返回 0，调用方据此不启动惯性。
     */
    end(): number {
        const velocity = this.releaseVelocity();
        this.disarmLongPress();
        this.origin = null;
        this.last = null;
        // 手势结束后清掉长按标记：didLongPress 只对本手势有效，留着会让外部读到过期状态
        this.pressed = false;
        this.scrolled = false;
        this.samples = [];
        return velocity;
    }

    private record(point: TouchPoint): void {
        const now = Date.now();
        this.samples.push({ t: now, y: point.y });
        // 按时间窗淘汰：停在原地的那段（浏览器仍会补 touchmove）留在窗口里会把末速度压回 0，
        // 于是“停住再抬手”不会误触发惯性；重新快速甩动时旧样本又会被清掉。
        const cutoff = now - TouchGestureRecognizer.VELOCITY_WINDOW_MS;
        this.samples = this.samples.filter((sample) => sample.t >= cutoff);
        if (this.samples.length > TouchGestureRecognizer.MAX_VELOCITY_SAMPLES) {
            this.samples.splice(0, this.samples.length - TouchGestureRecognizer.MAX_VELOCITY_SAMPLES);
        }
    }

    private releaseVelocity(): number {
        if (this.pressed || !this.scrolled || this.samples.length < 2) {
            return 0;
        }
        const first = this.samples[0];
        const last = this.samples[this.samples.length - 1];
        // 手指停住时浏览器基本不再发 touchmove，最后一次移动离抬手太久就说明早已停下，
        // 不能把旧样本的速度当成末速度，否则“甩一下再按住抬手”会莫名续滑
        if (Date.now() - last.t > TouchGestureRecognizer.VELOCITY_WINDOW_MS) {
            return 0;
        }
        const dt = last.t - first.t;
        if (dt <= 0) {
            return 0;
        }
        return (first.y - last.y) / dt;
    }

    private movedBeyondSlop(point: TouchPoint): boolean {
        if (this.origin === null) {
            return false;
        }
        const dx = point.x - this.origin.x;
        const dy = point.y - this.origin.y;
        return Math.hypot(dx, dy) > TouchGestureRecognizer.MOVE_SLOP_PX;
    }

    private disarmLongPress(): void {
        if (this.timer !== null) {
            clearTimeout(this.timer);
            this.timer = null;
        }
    }
}
