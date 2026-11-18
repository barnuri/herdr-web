import { appUrl } from './base';
export const DEFAULT_ENV_ID = 'default';
export const ENV_STORAGE_KEY = 'herdr-web:env';
export const ENV_POLL_MS = 10000;

export interface HerdrEnv {
    readonly id: string;
    readonly label: string;
    readonly default: boolean;
    readonly reachable: boolean;
}

export interface EnvSelection {
    readonly id: string;
    /** the wanted env is gone: the id that was dropped, for the notice */
    readonly fellBackFrom: string | null;
}

const ENV_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,31}$/;

export function isValidEnvId(value: unknown): value is string {
    return typeof value === 'string' && ENV_ID_PATTERN.test(value);
}

/** Only reachable envs count: the selector needs more than one of them. */
export function reachableEnvs(envs: readonly HerdrEnv[]): HerdrEnv[] {
    return envs.filter((env) => env.reachable);
}

export function shouldShowSelector(envs: readonly HerdrEnv[]): boolean {
    return reachableEnvs(envs).length > 1;
}

/** The env the page asks for: ?env= wins over the stored choice, else the default. */
export function wantedEnvId(search: string, storage: Pick<Storage, 'getItem'>): string {
    const fromUrl = new URLSearchParams(search).get('env');
    if (isValidEnvId(fromUrl)) {
        return fromUrl;
    }
    try {
        const stored = storage.getItem(ENV_STORAGE_KEY);
        if (isValidEnvId(stored)) {
            return stored;
        }
    } catch {
        // storage can be blocked; the default is always safe
    }
    return DEFAULT_ENV_ID;
}

export function resolveSelection(envs: readonly HerdrEnv[], wanted: string): EnvSelection {
    const live = reachableEnvs(envs);
    if (wanted === DEFAULT_ENV_ID || live.some((env) => env.id === wanted)) {
        return { id: wanted, fellBackFrom: null };
    }
    return { id: DEFAULT_ENV_ID, fellBackFrom: wanted };
}

/** Appends ?env=<id> unless the id is the default (the server's own default applies). */
export function withEnv(url: string, envId: string): string {
    if (envId === DEFAULT_ENV_ID) {
        return url;
    }
    return `${url}${url.includes('?') ? '&' : '?'}env=${encodeURIComponent(envId)}`;
}

export function persistEnv(envId: string, storage: Pick<Storage, 'setItem' | 'removeItem'>, history: Pick<History, 'replaceState'>, location: Pick<Location, 'href'>): void {
    try {
        if (envId === DEFAULT_ENV_ID) {
            storage.removeItem(ENV_STORAGE_KEY);
        } else {
            storage.setItem(ENV_STORAGE_KEY, envId);
        }
    } catch {
        // best effort
    }
    const url = new URL(location.href);
    if (envId === DEFAULT_ENV_ID) {
        url.searchParams.delete('env');
    } else {
        url.searchParams.set('env', envId);
    }
    history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
}

export async function fetchEnvs(fetcher: typeof fetch = fetch): Promise<HerdrEnv[] | null> {
    try {
        const response = await fetcher(appUrl('api/envs'), { cache: 'no-store' });
        if (!response.ok) {
            return null;
        }
        const body = (await response.json()) as unknown;
        if (!Array.isArray(body)) {
            return null;
        }
        return body.filter(
            (entry): entry is HerdrEnv =>
                typeof entry === 'object' && entry !== null && isValidEnvId((entry as HerdrEnv).id) && typeof (entry as HerdrEnv).label === 'string',
        );
    } catch {
        return null;
    }
}

export interface TopologyState<W, P> {
    readonly workspaces: W[];
    readonly panes: P[];
}

/** What the page shows right after switching env: nothing from the previous server. */
export function emptyTopology<W, P>(): TopologyState<W, P> {
    return { workspaces: [], panes: [] };
}
