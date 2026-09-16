import { useEffect, useState } from 'react';
import { Composer } from './components/Composer';
import { SettingsSheet } from './components/SettingsSheet';
import { ToastHost } from './components/ToastHost';
import { TopBar } from './components/TopBar';
import { XTermView } from './components/XTermView';
import { NotificationHelp } from './components/NotificationHelp';
import { insecureContextHelp, notificationSettingsHelp, untrustedCertHelp, webviewHelp } from './lib/notifications';
import { ALL_CHANGES_STORAGE_KEY, TOASTS_STORAGE_KEY, loadStoredSettings, shouldAnnounce } from './lib/notification-settings';
import type { NotificationSettings } from './lib/notification-settings';
import { quoteShellPath, uploadImage, validateImageFile } from './lib/terminal-image';
import type { NotificationSettingsHelp } from './lib/notifications';
import { useHerdrSocket } from './hooks/useHerdrSocket';
import { useNotifications } from './hooks/useNotifications';
import type { Notice } from './components/ToastHost';
import type { NotificationToggleResult } from './hooks/useNotifications';
import type { ArmedModifier } from './lib/modifier-keys';

const TOGGLE_NOTICES: Readonly<Record<NotificationToggleResult, Notice['text']>> = {
    'enabled-push': 'Push notifications on — delivered by the browser even when this page is closed',
    'enabled-local': 'Notifications on while this page is open (push unavailable in this browser)',
    'enabled-local-untrusted': 'Notifications on while this page is open — background push needs a trusted certificate',
    disabled: 'Notifications off',
    unsupported: 'Notifications need HTTPS (or localhost) — open via Tailscale/HTTPS to enable',
    denied: 'Notification permission denied — allow it in browser site settings',
};

let nextNoticeId = 0;

const HAS_COARSE_POINTER = window.matchMedia('(pointer: coarse)').matches;
const KEYBOARD_STORAGE_KEY = 'herdr-web:keyboard-enabled';

function initialKeyboardEnabled(): boolean {
    const stored = localStorage.getItem(KEYBOARD_STORAGE_KEY);
    if (stored === 'true' || stored === 'false') {
        return stored === 'true';
    }
    return !HAS_COARSE_POINTER;
}

export function App() {
    const { connected, status, panes, lastEvent, lastError, send, subscribeTerminal } = useHerdrSocket();
    const [stored, setStored] = useState(loadStoredSettings);
    const { enabled: notificationsEnabled, toggle: toggleNotifications, notifyForEvent } = useNotifications(stored.allChanges);
    const [notice, setNotice] = useState<Notice | null>(null);
    const [keyboardEnabled, setKeyboardEnabled] = useState(initialKeyboardEnabled);
    const [armedModifier, setArmedModifier] = useState<ArmedModifier | null>(null);
    const [uploadingImage, setUploadingImage] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(false);

    useEffect(() => {
        localStorage.setItem(KEYBOARD_STORAGE_KEY, String(keyboardEnabled));
    }, [keyboardEnabled]);

    useEffect(() => {
        localStorage.setItem(TOASTS_STORAGE_KEY, String(stored.toasts));
        localStorage.setItem(ALL_CHANGES_STORAGE_KEY, String(stored.allChanges));
    }, [stored]);
    const [help, setHelp] = useState<NotificationSettingsHelp | null>(null);

    const settings: NotificationSettings = { ...stored, device: notificationsEnabled };
    // one filter for both channels, so the sheet's wording matches what actually arrives
    const announced = lastEvent && shouldAnnounce(lastEvent, stored) ? lastEvent : null;

    useEffect(() => {
        if (!announced || !notificationsEnabled) {
            return;
        }
        void notifyForEvent(announced);
    }, [announced, notificationsEnabled, notifyForEvent]);

    // iOS ignores interactive-widget=resizes-content, so track the visual
    // viewport by hand: the app shrinks and the quick-keys bar rides above the
    // on-screen keyboard instead of being covered by it
    useEffect(() => {
        const viewport = window.visualViewport;
        if (!viewport) {
            return;
        }
        const apply = () => {
            // pinch-zoom shrinks visualViewport too (scale != 1) — only the keyboard
            // shrinks it at scale 1, so gate on scale to leave zoom alone
            const zoomed = Math.abs(viewport.scale - 1) > 0.01;
            const keyboardShowing = !zoomed && viewport.height < window.innerHeight - 1;
            document.documentElement.style.setProperty('--app-height', keyboardShowing ? `${viewport.height}px` : '100%');
        };
        viewport.addEventListener('resize', apply);
        apply();
        return () => viewport.removeEventListener('resize', apply);
    }, []);

    const showNotice = (text: string, tone: 'info' | 'warn' = 'info') => {
        nextNoticeId += 1;
        setNotice({ id: nextNoticeId, text, tone });
    };

    // An agent reads an image from disk, so the file is uploaded into the focused pane's
    // own folder and its path is typed into the pane for the user to prompt around.
    const onImageFiles = async (files: File[]) => {
        if (uploadingImage) {
            showNotice('Still uploading the previous image', 'info');
            return;
        }

        const accepted: File[] = [];
        for (const file of files) {
            const rejection = validateImageFile(file);
            if (rejection) {
                showNotice(rejection, 'warn');
                continue;
            }
            accepted.push(file);
        }
        if (accepted.length === 0) {
            return;
        }

        setUploadingImage(true);
        let uploaded = 0;
        try {
            for (const file of accepted) {
                try {
                    const savedPath = await uploadImage(file);
                    send({ type: 'input', data: `${quoteShellPath(savedPath)} ` });
                    uploaded += 1;
                } catch (error) {
                    showNotice(error instanceof Error ? error.message : 'Upload failed', 'warn');
                }
            }
        } finally {
            setUploadingImage(false);
        }

        if (uploaded > 0) {
            showNotice(uploaded === 1 ? 'Image path added to the pane' : `${uploaded} image paths added to the pane`);
        }
    };

    const onToggleNotifications = async () => {
        const result = await toggleNotifications();
        if (result === 'denied') {
            setHelp(notificationSettingsHelp(navigator.userAgent));
            return;
        }
        if (result === 'enabled-local-untrusted') {
            setHelp(untrustedCertHelp(navigator.userAgent));
            return;
        }
        if (result === 'unsupported') {
            // a secure context without the Notification API is an in-app WebView
            // (the Android shell), not a plain-HTTP problem: point at Chrome
            if (window.isSecureContext && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) {
                setHelp(webviewHelp(window.location.href));
                return;
            }
            let httpsUrl: string | null = null;
            try {
                const meta = (await (await fetch('/meta')).json()) as { https: boolean; httpsPort: number };
                if (meta.https) {
                    httpsUrl = `https://${window.location.hostname}:${meta.httpsPort}/`;
                }
            } catch {}
            setHelp(insecureContextHelp(httpsUrl));
            return;
        }
        showNotice(TOGGLE_NOTICES[result]);
    };

    return (
        <>
            <TopBar
                connected={connected}
                status={status}
                panes={panes}
                notificationsEnabled={notificationsEnabled || stored.toasts}
                onOpenSettings={() => setSettingsOpen(true)}
            />
            <XTermView
                connected={connected}
                keyboardEnabled={keyboardEnabled}
                armedModifier={armedModifier}
                onModifierApplied={() => setArmedModifier(null)}
                send={send}
                subscribeTerminal={subscribeTerminal}
                onImageFiles={(files) => void onImageFiles(files)}
            />
            <Composer
                disabled={!connected}
                keyboardEnabled={keyboardEnabled}
                armedModifier={armedModifier}
                onToggleKeyboard={() => setKeyboardEnabled((current) => !current)}
                onToggleModifier={(modifier) => setArmedModifier((current) => (current === modifier ? null : modifier))}
                onSendBytes={(bytes) => send({ type: 'input', data: bytes })}
                onImageFiles={(files) => void onImageFiles(files)}
                uploadingImage={uploadingImage}
            />
            <ToastHost event={settings.toasts ? announced : null} error={lastError} notice={notice} />
            <SettingsSheet
                open={settingsOpen}
                settings={settings}
                onChange={(key, value) => {
                    if (key === 'device') {
                        void onToggleNotifications();
                        return;
                    }
                    setStored((current) => ({ ...current, [key]: value }));
                }}
                onClose={() => setSettingsOpen(false)}
            />
            <NotificationHelp help={help} onClose={() => setHelp(null)} />
        </>
    );
}
