export interface VisualViewportSample {
    readonly width: number;
    readonly height: number;
    readonly offsetTop: number;
}

export interface ViewportLayout {
    readonly width: number;
    readonly fullHeight: number;
    readonly keyboardOffset: number;
}

/**
 * The app keeps the height it has with the keyboard closed and slides up by the keyboard's
 * height instead of shrinking, so the terminal never reflows. That full height is the tallest
 * visual viewport seen at the current width; a width change (rotation) starts over.
 */
export function nextViewportLayout(sample: VisualViewportSample, previous: ViewportLayout | null): ViewportLayout {
    const sameWidth = previous !== null && previous.width === sample.width;
    const fullHeight = sameWidth ? Math.max(previous.fullHeight, sample.height) : sample.height;
    const visibleBottom = sample.offsetTop + sample.height;
    return {
        width: sample.width,
        fullHeight,
        keyboardOffset: Math.max(0, fullHeight - visibleBottom),
    };
}
