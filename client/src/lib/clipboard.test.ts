import { describe, expect, it } from 'vitest';
import { parseOsc52 } from './clipboard';

const base64 = (text: string) => btoa(String.fromCharCode(...new TextEncoder().encode(text)));

describe('parseOsc52', () => {
    it('decodes the payload after the target list', () => {
        expect(parseOsc52('c;SGVsbG8=')).toBe('Hello');
    });

    it('decodes UTF-8', () => {
        expect(parseOsc52(`c;${base64('héllo ✓')}`)).toBe('héllo ✓');
    });

    it('accepts an empty target list', () => {
        expect(parseOsc52(';SGVsbG8=')).toBe('Hello');
    });

    it('ignores clipboard read requests', () => {
        expect(parseOsc52('c;?')).toBeNull();
    });

    it('ignores an empty payload and bad base64', () => {
        expect(parseOsc52('c;')).toBeNull();
        expect(parseOsc52('c;***')).toBeNull();
        expect(parseOsc52('no-separator')).toBeNull();
    });
});
