const RTL_CHAR = /[֐-ࣿיִ-﷿ﹰ-﻿]/;
const STRONG_LTR_CHAR = /\p{L}/u;
// herdr draws pane borders and sidebars with these; a run must never reorder across them
const LAYOUT_CHAR = /[─-▟-]/;
const MIN_RUN_LENGTH = 2;

export function hasRtl(text: string): boolean {
    return RTL_CHAR.test(text);
}

// an empty string is the trailing half of a wide character, which a run must never split
function breaksRun(char: string): boolean {
    if (char === '' || LAYOUT_CHAR.test(char)) {
        return true;
    }
    return STRONG_LTR_CHAR.test(char) && !RTL_CHAR.test(char);
}

/**
 * Ranges `[start, end)` from the first to the last RTL character of each run, with neutrals
 * (spaces, digits, punctuation) kept inside. `cells` holds one terminal cell per entry.
 */
export function findRtlRuns(cells: ArrayLike<string>): [number, number][] {
    const runs: [number, number][] = [];
    let runStart = -1;
    let runEnd = -1;
    const closeRun = () => {
        if (runStart >= 0 && runEnd - runStart >= MIN_RUN_LENGTH) {
            runs.push([runStart, runEnd]);
        }
        runStart = -1;
    };
    for (let index = 0; index < cells.length; index++) {
        const char = cells[index];
        if (RTL_CHAR.test(char)) {
            if (runStart < 0) {
                runStart = index;
            }
            runEnd = index + 1;
            continue;
        }
        if (breaksRun(char)) {
            closeRun();
        }
    }
    closeRun();
    return runs;
}
