import { describe, expect, it } from 'vitest';
import { findRtlRuns } from './bidi-runs';

describe('findRtlRuns', () => {
    it('returns no runs for LTR-only text', () => {
        expect(findRtlRuns('hello world 123')).toEqual([]);
        expect(findRtlRuns('')).toEqual([]);
    });

    it('joins Hebrew words and the spaces between them into one run', () => {
        expect(findRtlRuns('שלום עולם')).toEqual([[0, 9]]);
    });

    it('keeps digits between Hebrew words inside the run', () => {
        expect(findRtlRuns('abc שלום 123 עולם xyz')).toEqual([[4, 17]]);
    });

    it('splits runs at Latin letters', () => {
        expect(findRtlRuns('קובץ config.toml לא נמצא')).toEqual([
            [0, 4],
            [17, 24],
        ]);
    });

    it('excludes trailing neutrals from the run', () => {
        expect(findRtlRuns('שלום, ')).toEqual([[0, 4]]);
    });

    it('splits runs at box-drawing borders', () => {
        expect(findRtlRuns('שלום │ עולם')).toEqual([
            [0, 4],
            [7, 11],
        ]);
    });

    it('skips single RTL characters', () => {
        expect(findRtlRuns('a ש b')).toEqual([]);
    });

    it('splits runs at the trailing half of a wide character', () => {
        expect(findRtlRuns(['ש', 'ל', '😀', '', 'ע', 'ו'])).toEqual([
            [0, 2],
            [4, 6],
        ]);
    });
});
