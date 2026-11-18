import { useCallback, useEffect, useRef, useState } from 'react';
import { formatAgentNotification } from '../lib/notifications';
import { subscribeToPush, unsubscribeFromPush } from '../lib/push';
import type { AgentEvent } from '../types';
import { appUrl } from '../lib/base';

const STORAGE_KEY = 'herdr-web:notifications-enabled';
const MODE_STORAGE_KEY = 'herdr-web:notifications-mode';

export type NotificationMode = 'push' | 'local';
export type NotificationToggleResult =
    | 'enabled-push'
    | 'enabled-local'
    | 'enabled-local-untrusted'
    | 'disabled'
    | 'unsupported'
    | 'denied';

export interface NotificationControls {
    readonly enabled: boolean;
    readonly toggle: () => Promise<NotificationToggleResult>;
    readonly notifyForEvent: (event: AgentEvent) => Promise<void>;
}

export function useNotifications(allChanges: boolean): NotificationControls {
    const [enabled, setEnabled] = useState(() => localStorage.getItem(STORAGE_KEY) === 'true');
    const [mode, setMode] = useState<NotificationMode>(() =>
        localStorage.getItem(MODE_STORAGE_KEY) === 'local' ? 'local' : 'push',
    );

    useEffect(() => {
        localStorage.setItem(STORAGE_KEY, String(enabled));
        localStorage.setItem(MODE_STORAGE_KEY, mode);
    }, [enabled, mode]);

    // self-heal on load: "enabled" without a live push subscription is a silent
    // black hole (bell enabled before push existed, cleared site data, a server
    // wipe, or push blocked at the time — e.g. before the cert was trusted).
    // Try push whenever notifications are on: success upgrades local → push,
    // failure downgrades push → local, so the stored mode always matches reality.
    useEffect(() => {
        if (!enabled) {
            return;
        }
        if (!('Notification' in window) || Notification.permission !== 'granted') {
            return;
        }
        subscribeToPush(allChanges)
            .then((outcome) => {
                setMode(typeof outcome === 'string' ? 'local' : 'push');
            })
            .catch((err: unknown) => {
                if (err instanceof Error) {
                    console.error('push re-sync failed:', err.message);
                }
            });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const toggle = useCallback(async (): Promise<NotificationToggleResult> => {
        if (enabled) {
            setEnabled(false);
            try {
                await unsubscribeFromPush();
            } catch {}
            return 'disabled';
        }
        if (!('Notification' in window)) {
            return 'unsupported';
        }
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
            return 'denied';
        }
        // real Web Push first (browser delivers system notifications even with the
        // page closed); page-side notifications remain as the fallback
        let failure: string | null = null;
        try {
            const outcome = await subscribeToPush(allChanges);
            if (typeof outcome !== 'string') {
                setMode('push');
                setEnabled(true);
                return 'enabled-push';
            }
            failure = outcome;
        } catch (err) {
            if (err instanceof Error) {
                console.error('push subscription failed:', err.message);
            }
        }
        setMode('local');
        setEnabled(true);
        // a service worker refusing to register on an https page = the cert
        // isn't trusted by this device (plain-http localhost registers fine)
        if (failure === 'no-service-worker' && window.location.protocol === 'https:') {
            return 'enabled-local-untrusted';
        }
        return 'enabled-local';
    }, [enabled, allChanges]);

    // the server filters background push per subscription, so a verbosity change
    // has to be re-registered against the live subscription to take effect.
    // Mount is already covered by the self-heal effect above.
    const lastPushedVerbosity = useRef(allChanges);
    useEffect(() => {
        if (lastPushedVerbosity.current === allChanges) {
            return;
        }
        lastPushedVerbosity.current = allChanges;
        if (!enabled || mode !== 'push') {
            return;
        }
        void subscribeToPush(allChanges).catch(() => {});
    }, [allChanges, enabled, mode]);

    const notifyForEvent = useCallback(
        async (event: AgentEvent) => {
            // events arrive pre-filtered by the notification settings; push mode is
            // served by the service worker instead, so the page must not double up
            if (!enabled || mode === 'push') {
                return;
            }
            if (!('Notification' in window) || Notification.permission !== 'granted') {
                return;
            }
            const { title, body } = formatAgentNotification(event);
            const registration = await navigator.serviceWorker?.getRegistration();
            if (registration) {
                await registration.showNotification(title, { body, icon: appUrl('icon-192.png'), tag: event.paneId });
                return;
            }
            new Notification(title, { body, icon: appUrl('icon-192.png'), tag: event.paneId });
        },
        [enabled, mode],
    );

    return { enabled, toggle, notifyForEvent };
}
