// xterm 的像素模式滚轮处理对小位移有折扣（不足 50px 只按 30% 生效）并按整行取整，
// 而触摸拖动每次移动只有几个像素——大部分位移被吞掉，表现为终端“不跟手”。
// 这里把像素位移自己换算成整行，用行模式（DOM_DELTA_LINE）派发，xterm 对行模式不再打折。
export const SCROLL_MAX_NOTCHES = 3;

// 惯性参数（收口在此，便于后续调优）。速度单位为 px/ms，符号与 onScroll 的 deltaY 一致：
// 正 = 手指上滑 = 看更新的内容。
/** 低于此末速度不启动惯性，避免慢速拖完手后的“漂移” */
export const FLING_MIN_VELOCITY = 0.15;
/** 末速度上限，防止一次甩动飞出太远 */
export const FLING_MAX_VELOCITY = 4;
/** 每毫秒速度保留比例（指数阻尼，接近平台滚动惯性手感） */
export const FLING_DECAY_PER_MS = 0.997;
/** 速度衰减到此值以下即停止 */
export const FLING_STOP_VELOCITY = 0.02;
/** 惯性最长时间上限（毫秒），兜底防止低衰减下无限滚动 */
export const FLING_MAX_DURATION_MS = 1500;
/** 单帧最大时间步长（毫秒）：切到后台再回来时不要把停顿算进衰减 */
export const FLING_MAX_FRAME_MS = 32;

export interface ScrollPlan {
    /** 本次应立即应用的行数；符号即滚动方向（正 = 向下/看更新的内容） */
    readonly lines: number;
    /** 不足一行的像素余量，留给下一次移动 */
    readonly remainder: number;
}

export function planScroll(
    deltaY: number,
    cellHeight: number,
    remainder: number,
    maxNotches = SCROLL_MAX_NOTCHES,
): ScrollPlan {
    const height = cellHeight > 0 ? cellHeight : 16;
    // 反向拖动时丢弃旧余量，否则会先“还债”再反向；deltaY 为 0 的中断事件（手指静止
    // 也会触发 touchmove）不算反向，余量必须保留，否则每次静止都会把已累计的位移清零
    const reversed = deltaY !== 0 && remainder !== 0 && Math.sign(deltaY) !== Math.sign(remainder);
    const carried = reversed ? 0 : remainder;
    const pending = carried + deltaY;
    const rawLines = Math.trunc(pending / height);
    // 归一化 -0：Math.trunc 对小负数返回 -0，Object.is(-0, 0) 为 false，会让调用方误判
    const clamped = Math.max(-maxNotches, Math.min(maxNotches, rawLines));
    const lines = clamped === 0 ? 0 : clamped;
    const clamp = height * maxNotches;
    const rest = pending - lines * height;
    return { lines, remainder: Math.max(-clamp, Math.min(clamp, rest)) };
}

// 松手后的惯性行程：按指数阻尼把末速度消耗成像素位移，调用方每帧取一次 step()。
// 只做纯数学，不碰 DOM/时间源，所以衰减曲线和停止条件都能用单测钉住。
export class ScrollFling {
    private velocity: number;

    private elapsedMs = 0;

    constructor(releaseVelocity: number) {
        const clamped = Math.max(-FLING_MAX_VELOCITY, Math.min(FLING_MAX_VELOCITY, releaseVelocity));
        this.velocity = Math.abs(clamped) < FLING_MIN_VELOCITY ? 0 : clamped;
    }

    /** 还有行程可走时为 true；false 后调用方应停止逐帧推进 */
    get active(): boolean {
        return this.velocity !== 0;
    }

    /**
     * 推进 dtMs 毫秒，返回这段时间应滚动的像素位移。
     * 位移用梯形积分（起止速度均值 × 时间），比按帧末速度取样更贴近真实减速行程。
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
        // 衰减后低于停止阈值、或超出时长上限，就这一次走完后收手
        this.velocity =
            Math.abs(next) < FLING_STOP_VELOCITY || this.elapsedMs >= FLING_MAX_DURATION_MS ? 0 : next;
        return distance;
    }

    /** 到边界或手势被打断时提前结束 */
    stop(): void {
        this.velocity = 0;
    }
}
