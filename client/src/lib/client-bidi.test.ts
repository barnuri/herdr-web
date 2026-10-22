import { describe, expect, it } from 'vitest';
import { clientBidiFromMeta } from './client-bidi';

describe('clientBidiFromMeta', () => {
    it('is on when the server does not say otherwise', () => {
        expect(clientBidiFromMeta({ https: true })).toBe(true);
        expect(clientBidiFromMeta({ clientBidi: true })).toBe(true);
        expect(clientBidiFromMeta(null)).toBe(true);
        expect(clientBidiFromMeta('oops')).toBe(true);
    });

    it('is off only for an explicit false', () => {
        expect(clientBidiFromMeta({ clientBidi: false })).toBe(false);
    });
});
