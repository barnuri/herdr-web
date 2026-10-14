import { describe, expect, it } from 'vitest';
import { entryScriptIn, isNewerBuild } from './build-version';

describe('entryScriptIn', () => {
    it('finds the hashed entry bundle in index.html', () => {
        const html = '<script type="module" crossorigin src="/assets/index-9bj1sKTN.js"></script>';
        expect(entryScriptIn(html)).toBe('/assets/index-9bj1sKTN.js');
    });

    it('returns null when there is no hashed bundle (dev server)', () => {
        expect(entryScriptIn('<script type="module" src="/src/main.tsx"></script>')).toBeNull();
    });
});

describe('isNewerBuild', () => {
    it('is true only when both hashes are known and differ', () => {
        expect(isNewerBuild('/assets/index-a.js', '/assets/index-b.js')).toBe(true);
        expect(isNewerBuild('/assets/index-a.js', '/assets/index-a.js')).toBe(false);
        expect(isNewerBuild(null, '/assets/index-b.js')).toBe(false);
        expect(isNewerBuild('/assets/index-a.js', null)).toBe(false);
    });
});
