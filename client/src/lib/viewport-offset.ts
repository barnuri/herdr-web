export interface VisualViewportSample {
    readonly height: number;
    readonly offsetTop: number;
}

export interface ViewportLayout {
    readonly height: number;
    readonly top: number;
}

/**
 * The app fills exactly the visible area: it shrinks to the space above the on-screen keyboard
 * (the terminal refits to fewer rows) and follows the visual viewport when the browser pans it,
 * so neither its top nor its bottom ends up off-screen.
 */
export function nextViewportLayout(sample: VisualViewportSample): ViewportLayout {
    return {
        height: Math.max(0, sample.height),
        top: Math.max(0, sample.offsetTop),
    };
}
