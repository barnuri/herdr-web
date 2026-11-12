import { describe, expect, it, vi } from 'vitest';
import { KittyImageStore } from './image-store';
import { parseKittyControl } from './control';
import type { KittyBitmap, KittyBitmapDecoder } from './types';

const ANCHOR = { col: 4, absRow: 12 };

function rgbaBase64(width: number, height: number): string {
    const bytes = new Uint8Array(width * height * 4).fill(7);
    return btoa(String.fromCharCode(...bytes));
}

function makeBitmap(width: number, height: number, close: () => void = () => {}): KittyBitmap {
    return { width, height, source: {} as CanvasImageSource, close };
}

function buildStore(decode = vi.fn<KittyBitmapDecoder>(async () => makeBitmap(2, 1)), graceMs = 0) {
    const onChange = vi.fn();
    return { store: new KittyImageStore(decode, onChange, graceMs), decode, onChange };
}

function feed(store: KittyImageStore, control: string, payload = '', anchor = ANCHOR) {
    store.handleSequence(parseKittyControl(control), payload, anchor);
}

describe('KittyImageStore', () => {
    it('decodes a single-chunk RGBA transfer', async () => {
        const { store, decode } = buildStore();
        feed(store, 'a=t,t=d,f=32,s=2,v=1,i=5,m=0', rgbaBase64(2, 1));
        await vi.waitFor(() => expect(store.bitmapFor(5)).toBeDefined());
        expect(decode).toHaveBeenCalledTimes(1);
        expect(decode.mock.calls[0][1]).toBe(2);
        expect(decode.mock.calls[0][2]).toBe(1);
    });

    it('reassembles a chunked transfer before decoding', async () => {
        const { store, decode } = buildStore();
        const payload = rgbaBase64(2, 1);
        feed(store, 'a=t,t=d,f=32,s=2,v=1,i=5,m=1', payload.slice(0, 4));
        expect(decode).not.toHaveBeenCalled();
        feed(store, 'm=0', payload.slice(4));
        await vi.waitFor(() => expect(store.bitmapFor(5)).toBeDefined());
    });

    it('ignores a transfer in a format other than RGBA', () => {
        const { store, decode } = buildStore();
        feed(store, 'a=t,t=d,f=100,s=2,v=1,i=5,m=0', rgbaBase64(2, 1));
        expect(decode).not.toHaveBeenCalled();
    });

    it('ignores a payload shorter than the declared pixel dimensions', () => {
        const { store, decode } = buildStore();
        feed(store, 'a=t,t=d,f=32,s=8,v=8,i=5,m=0', rgbaBase64(2, 1));
        expect(decode).not.toHaveBeenCalled();
    });

    it('anchors a placement at the cursor position', () => {
        const { store } = buildStore();
        feed(store, 'a=p,i=5,p=99,c=29,r=37');
        expect([...store.visiblePlacements]).toEqual([
            { imageId: 5, placementId: 99, col: 4, absRow: 12, cols: 29, rows: 37 },
        ]);
    });

    it('ignores a placement that arrives without a cursor anchor', () => {
        const { store } = buildStore();
        store.handleSequence(parseKittyControl('a=p,i=5,p=99,c=29,r=37'), '', null);
        expect([...store.visiblePlacements]).toEqual([]);
    });

    it('drops the image and its placements on delete', async () => {
        const closed = vi.fn();
        const { store } = buildStore(vi.fn<KittyBitmapDecoder>(async () => makeBitmap(2, 1, closed)));
        feed(store, 'a=t,t=d,f=32,s=2,v=1,i=5,m=0', rgbaBase64(2, 1));
        await vi.waitFor(() => expect(store.bitmapFor(5)).toBeDefined());
        feed(store, 'a=p,i=5,p=99,c=2,r=1');

        feed(store, 'a=d,d=I,i=5');

        expect(store.bitmapFor(5)).toBeUndefined();
        expect([...store.visiblePlacements]).toEqual([]);
        expect(closed).toHaveBeenCalledTimes(1);
    });

    it('discards a decode that finishes after its image was deleted', async () => {
        const closed = vi.fn();
        let release: () => void = () => {};
        const decode = vi.fn<KittyBitmapDecoder>(
            () =>
                new Promise<KittyBitmap>((resolve) => {
                    release = () => resolve(makeBitmap(2, 1, closed));
                }),
        );
        const { store } = buildStore(decode);
        feed(store, 'a=t,t=d,f=32,s=2,v=1,i=5,m=0', rgbaBase64(2, 1));
        feed(store, 'a=d,d=I,i=5');

        release();
        await vi.waitFor(() => expect(closed).toHaveBeenCalledTimes(1));
        expect(store.bitmapFor(5)).toBeUndefined();
    });

    it('closes every bitmap and forgets all state on clear', async () => {
        const closed = vi.fn();
        const { store, onChange } = buildStore(vi.fn<KittyBitmapDecoder>(async () => makeBitmap(2, 1, closed)));
        feed(store, 'a=t,t=d,f=32,s=2,v=1,i=5,m=0', rgbaBase64(2, 1));
        await vi.waitFor(() => expect(store.bitmapFor(5)).toBeDefined());
        feed(store, 'a=p,i=5,p=99,c=2,r=1');
        onChange.mockClear();

        store.clear();

        expect(closed).toHaveBeenCalledTimes(1);
        expect([...store.visiblePlacements]).toEqual([]);
        expect(onChange).toHaveBeenCalledTimes(1);
    });

    describe('delete grace period', () => {
        it('keeps the old frame until a new frame for the same id replaces it', async () => {
            vi.useFakeTimers();
            try {
                const closed = vi.fn();
                const { store } = buildStore(vi.fn<KittyBitmapDecoder>(async () => makeBitmap(2, 1, closed)), 150);
                feed(store, 'a=t,t=d,f=32,s=2,v=1,i=5,m=0', rgbaBase64(2, 1));
                await vi.waitFor(() => expect(store.bitmapFor(5)).toBeDefined());
                feed(store, 'a=p,i=5,p=99,c=2,r=1');

                feed(store, 'a=d,d=I,i=5');
                expect(store.bitmapFor(5)).toBeDefined();
                expect([...store.visiblePlacements]).toHaveLength(1);

                feed(store, 'a=t,t=d,f=32,s=2,v=1,i=5,m=0', rgbaBase64(2, 1));
                vi.advanceTimersByTime(500);

                expect([...store.visiblePlacements]).toHaveLength(1);
                await vi.waitFor(() => expect(store.bitmapFor(5)).toBeDefined());
            } finally {
                vi.useRealTimers();
            }
        });

        it('still removes the image once the grace period passes with no new frame', async () => {
            vi.useFakeTimers();
            try {
                const { store } = buildStore(undefined, 150);
                feed(store, 'a=t,t=d,f=32,s=2,v=1,i=5,m=0', rgbaBase64(2, 1));
                await vi.waitFor(() => expect(store.bitmapFor(5)).toBeDefined());
                feed(store, 'a=p,i=5,p=99,c=2,r=1');

                feed(store, 'a=d,d=I,i=5');
                vi.advanceTimersByTime(150);

                expect(store.bitmapFor(5)).toBeUndefined();
                expect([...store.visiblePlacements]).toEqual([]);
            } finally {
                vi.useRealTimers();
            }
        });
    });
});
