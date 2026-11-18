// The herdr desktop app's world, read from hc (terminals) and `herdr-app ls` (space and tab names).
export const SPACE_LABEL = 'herdr.space';
export const TAB_LABEL = 'herdr.tab';
export const VIEW_STORAGE_KEY = 'herdr-web:view';
export const WORLD_POLL_MS = 3000;

export type AppView = 'tui' | 'desktop';

export interface HcTerminal {
    readonly address: string;
    readonly name?: string | null;
    readonly title?: string | null;
    readonly cwd?: string | null;
    readonly labels?: Readonly<Record<string, string>>;
    readonly status?: { readonly app?: string | null; readonly state?: string | null } | null;
    readonly foreground?: { readonly name?: string | null } | null;
}

export interface AppTabTerminal {
    readonly terminal: string;
    readonly status?: string | null;
    readonly app?: string | null;
}

export interface AppTab {
    readonly id: string;
    readonly name: string;
    readonly terminals?: readonly AppTabTerminal[];
}

export interface AppSpace {
    readonly id: string;
    readonly name: string;
    readonly folder?: string | null;
    readonly tabs: readonly AppTab[];
}

export interface DesktopTerminal {
    readonly address: string;
    readonly title: string;
    readonly agent: string | null;
    readonly status: string | undefined;
}

export interface DesktopTab {
    /** Null for the terminals of a space that carry no tab label. */
    readonly id: string | null;
    readonly name: string;
    readonly terminals: DesktopTerminal[];
}

export interface DesktopSpace {
    /** Null for the group of terminals that belong to no space. */
    readonly id: string | null;
    readonly name: string;
    readonly folder: string | null;
    readonly tabs: DesktopTab[];
}

export function loadView(storage: Pick<Storage, 'getItem'> = localStorage): AppView {
    return storage.getItem(VIEW_STORAGE_KEY) === 'desktop' ? 'desktop' : 'tui';
}

function toDesktopTerminal(terminal: HcTerminal, appStatus: AppTabTerminal | undefined): DesktopTerminal {
    const agent = terminal.status?.app ?? appStatus?.app ?? null;
    return {
        address: terminal.address,
        title: terminal.name || terminal.title || terminal.foreground?.name || terminal.address,
        agent,
        status: terminal.status?.state ?? appStatus?.status ?? undefined,
    };
}

// `where` is hc's "space / tab" caption: the only name source when herdr-app is not running
function namesFromWhere(terminal: HcTerminal): { space: string | null; tab: string | null } {
    const where = terminal.labels?.where;
    if (!where) {
        return { space: null, tab: null };
    }
    const cut = where.lastIndexOf(' / ');
    return cut < 0 ? { space: where, tab: null } : { space: where.slice(0, cut), tab: where.slice(cut + 3) };
}

/** Groups the live terminals by space and tab in the app's order; terminals of no space come last. */
export function groupWorld(spaces: readonly AppSpace[] | null, terminals: readonly HcTerminal[]): DesktopSpace[] {
    const appStatus = new Map<string, AppTabTerminal>();
    for (const space of spaces ?? []) {
        for (const tab of space.tabs) {
            for (const entry of tab.terminals ?? []) {
                appStatus.set(entry.terminal, entry);
            }
        }
    }

    const result: DesktopSpace[] = (spaces ?? []).map((space) => ({
        id: space.id,
        name: space.name,
        folder: space.folder ?? null,
        tabs: space.tabs.map((tab) => ({ id: tab.id, name: tab.name, terminals: [] })),
    }));
    const loose: DesktopTab = { id: null, name: 'other', terminals: [] };

    for (const terminal of terminals) {
        const item = toDesktopTerminal(terminal, appStatus.get(terminal.address));
        const spaceId = terminal.labels?.[SPACE_LABEL];
        if (!spaceId) {
            loose.terminals.push(item);
            continue;
        }
        const names = namesFromWhere(terminal);
        let space = result.find((candidate) => candidate.id === spaceId);
        if (!space) {
            space = { id: spaceId, name: names.space ?? spaceId, folder: null, tabs: [] };
            result.push(space);
        }
        const tabId = terminal.labels?.[TAB_LABEL] ?? null;
        let tab = space.tabs.find((candidate) => candidate.id === tabId);
        if (!tab) {
            tab = { id: tabId, name: tabId === null ? 'no tab' : (names.tab ?? tabId), terminals: [] };
            space.tabs.push(tab);
        }
        tab.terminals.push(item);
    }

    if (loose.terminals.length > 0) {
        result.push({ id: null, name: 'not in a space', folder: null, tabs: [loose] });
    }
    return result;
}
