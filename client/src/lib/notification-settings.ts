import type { AgentEvent } from '../types';

// Which agent transitions are loud enough to interrupt for. `notifyWorthy` is
// decided server-side (an agent that finished or needs attention); everything
// else is a state change the herd dots already show without interrupting.
export interface NotificationSettings {
    // banners drawn inside this page while it is open
    readonly toasts: boolean;
    // browser/system notifications, delivered even when the page is closed
    readonly device: boolean;
    // false = only "needs attention" and "finished"; true = every transition
    readonly allChanges: boolean;
}

export const TOASTS_STORAGE_KEY = 'herdr-web:toasts-enabled';
export const ALL_CHANGES_STORAGE_KEY = 'herdr-web:notify-all-changes';

// Everything off until the user opts in from settings.
export const DEFAULT_SETTINGS: NotificationSettings = {
    toasts: false,
    device: false,
    allChanges: false,
};

function readFlag(key: string, fallback: boolean): boolean {
    const stored = localStorage.getItem(key);
    if (stored === 'true' || stored === 'false') {
        return stored === 'true';
    }
    return fallback;
}

export function loadStoredSettings(): Omit<NotificationSettings, 'device'> {
    return {
        toasts: readFlag(TOASTS_STORAGE_KEY, DEFAULT_SETTINGS.toasts),
        allChanges: readFlag(ALL_CHANGES_STORAGE_KEY, DEFAULT_SETTINGS.allChanges),
    };
}

export function shouldAnnounce(event: AgentEvent, settings: Pick<NotificationSettings, 'allChanges'>): boolean {
    // the first status a pane reports is not a transition anyone asked about
    if (event.from === null) {
        return false;
    }
    return settings.allChanges || event.notifyWorthy;
}
