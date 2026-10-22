const DIGIT = /^[0-9٠-٩۰-۹]$/;
const NUMBER_SEPARATOR = /^[.,:/]$/;
const MIRRORED: Readonly<Record<string, string>> = {
    '(': ')',
    ')': '(',
    '[': ']',
    ']': '[',
    '{': '}',
    '}': '{',
    '<': '>',
    '>': '<',
    '«': '»',
    '»': '«',
};

function numberEnd(chars: readonly string[], start: number): number {
    let end = start + 1;
    while (end < chars.length) {
        if (DIGIT.test(chars[end])) {
            end++;
            continue;
        }
        const joinsDigits = NUMBER_SEPARATOR.test(chars[end]) && end + 1 < chars.length && DIGIT.test(chars[end + 1]);
        if (!joinsDigits) {
            break;
        }
        end += 2;
    }
    return end;
}

/**
 * Visual order of one RTL run (as found by `findRtlRuns`): entry `v` is the logical index drawn
 * in the run's `v`-th cell from the left. Numbers such as `1,000` or `12:30` keep LTR order.
 */
export function visualOrder(chars: readonly string[]): number[] {
    const tokens: [number, number][] = [];
    let start = 0;
    while (start < chars.length) {
        const end = DIGIT.test(chars[start]) ? numberEnd(chars, start) : start + 1;
        tokens.push([start, end]);
        start = end;
    }
    const order: number[] = [];
    for (const [tokenStart, tokenEnd] of tokens.reverse()) {
        for (let index = tokenStart; index < tokenEnd; index++) {
            order.push(index);
        }
    }
    return order;
}

/** The glyph a character shows at right-to-left level: brackets point the other way. */
export function mirrorChar(char: string): string {
    return MIRRORED[char] ?? char;
}
