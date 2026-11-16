import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { EnvSelector } from '../components/EnvSelector';
import {
    ENV_STORAGE_KEY,
    emptyTopology,
    fetchEnvs,
    isValidEnvId,
    persistEnv,
    reachableEnvs,
    resolveSelection,
    shouldShowSelector,
    wantedEnvId,
    withEnv,
} from './envs';
import type { HerdrEnv } from './envs';

const DEFAULT: HerdrEnv = { id: 'default', label: 'default', default: true, reachable: true };
const ORCH: HerdrEnv = { id: 'orch', label: 'orch', default: false, reachable: true };
const DEAD: HerdrEnv = { id: 'dead', label: 'dead', default: false, reachable: false };

const memoryStorage = (initial: Record<string, string> = {}) => {
    const data = new Map(Object.entries(initial));
    return {
        getItem: (key: string) => data.get(key) ?? null,
        setItem: (key: string, value: string) => void data.set(key, value),
        removeItem: (key: string) => void data.delete(key),
    };
};

const render = (envs: HerdrEnv[], value = 'default') =>
    renderToStaticMarkup(createElement(EnvSelector, { envs, value, onChange: () => undefined }));

describe('selector visibility', () => {
    it('renders nothing with one env', () => {
        expect(render([DEFAULT])).toBe('');
    });

    it('renders nothing when the second env is unreachable', () => {
        expect(shouldShowSelector([DEFAULT, DEAD])).toBe(false);
        expect(render([DEFAULT, DEAD])).toBe('');
    });

    it('renders a labelled native select with two envs and the default selected', () => {
        const html = render([DEFAULT, ORCH]);
        expect(html).toContain('<select');
        expect(html).toContain('aria-label="Herdr environment"');
        expect(html).toContain('<option value="default" selected="">default</option>');
        expect(html).toContain('>orch</option>');
    });

    it('lists only reachable envs', () => {
        expect(reachableEnvs([DEFAULT, ORCH, DEAD]).map((e) => e.id)).toEqual(['default', 'orch']);
        expect(render([DEFAULT, ORCH, DEAD])).not.toContain('dead');
    });
});

describe('selection and persistence', () => {
    it('defaults to the default env', () => {
        expect(wantedEnvId('', memoryStorage())).toBe('default');
    });

    it('prefers the URL over localStorage', () => {
        expect(wantedEnvId('?env=orch', memoryStorage({ [ENV_STORAGE_KEY]: 'other' }))).toBe('orch');
        expect(wantedEnvId('', memoryStorage({ [ENV_STORAGE_KEY]: 'orch' }))).toBe('orch');
    });

    it('ignores path-like ids from the URL or storage', () => {
        expect(isValidEnvId('../x')).toBe(false);
        expect(wantedEnvId('?env=../x', memoryStorage())).toBe('default');
        expect(wantedEnvId('', memoryStorage({ [ENV_STORAGE_KEY]: '/etc' }))).toBe('default');
    });

    it('writes the choice to localStorage and the URL, and clears both for the default', () => {
        const storage = memoryStorage();
        const history = { replaceState: vi.fn() };
        persistEnv('orch', storage, history, { href: 'http://h/?x=1#top' });
        expect(storage.getItem(ENV_STORAGE_KEY)).toBe('orch');
        expect(history.replaceState).toHaveBeenLastCalledWith(null, '', '/?x=1&env=orch#top');
        persistEnv('default', storage, history, { href: 'http://h/?x=1&env=orch' });
        expect(storage.getItem(ENV_STORAGE_KEY)).toBeNull();
        expect(history.replaceState).toHaveBeenLastCalledWith(null, '', '/?x=1');
    });

    it('keeps an available env and falls back to default when it disappeared', () => {
        expect(resolveSelection([DEFAULT, ORCH], 'orch')).toEqual({ id: 'orch', fellBackFrom: null });
        expect(resolveSelection([DEFAULT], 'orch')).toEqual({ id: 'default', fellBackFrom: 'orch' });
        expect(resolveSelection([DEFAULT, DEAD], 'dead')).toEqual({ id: 'default', fellBackFrom: 'dead' });
        expect(resolveSelection([], 'default')).toEqual({ id: 'default', fellBackFrom: null });
    });
});

describe('switching', () => {
    it('changes the request URLs and keeps the default untouched', () => {
        expect(withEnv('ws://h/ws?device=desktop', 'default')).toBe('ws://h/ws?device=desktop');
        expect(withEnv('ws://h/ws?device=desktop', 'orch')).toBe('ws://h/ws?device=desktop&env=orch');
        expect(withEnv('/images', 'orch')).toBe('/images?env=orch');
    });

    it('starts from an empty topology', () => {
        expect(emptyTopology()).toEqual({ workspaces: [], panes: [] });
    });
});

describe('fetchEnvs', () => {
    it('parses the list and drops malformed entries', async () => {
        const fetcher = vi.fn(async () => new Response(JSON.stringify([DEFAULT, { id: '../x', label: 'x' }, ORCH])));
        expect((await fetchEnvs(fetcher as unknown as typeof fetch))?.map((e) => e.id)).toEqual(['default', 'orch']);
    });

    it('returns null on failure', async () => {
        const fetcher = vi.fn(async () => new Response('x', { status: 500 }));
        expect(await fetchEnvs(fetcher as unknown as typeof fetch)).toBeNull();
        expect(await fetchEnvs((async () => { throw new Error('down'); }) as unknown as typeof fetch)).toBeNull();
    });
});
