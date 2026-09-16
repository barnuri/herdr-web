import type { AgentEvent } from '../types';

export interface NotificationContent {
    readonly title: string;
    readonly body: string;
}

export function formatAgentNotification(event: AgentEvent): NotificationContent {
    const agent = event.agent ?? 'agent';
    // 标题和 paneId 都缺失时仍要满足 body: string 的契约，不能让 undefined 流到通知层
    const where = (event.title && event.title.length > 0 ? event.title : event.paneId) || agent;
    if (event.to === 'blocked') {
        return { title: `${agent} needs attention`, body: where };
    }
    if (event.from === 'working') {
        return { title: `${agent} finished (${event.to})`, body: where };
    }
    return { title: `${agent}: ${String(event.from)} → ${event.to}`, body: where };
}

// pages cannot navigate to browser-internal settings URLs, so the best a web
// app can do on a denied permission is hand the user the exact address
export function browserNotificationSettingsUrl(userAgent: string): string {
    if (userAgent.includes('Edg/')) {
        return 'edge://settings/content/notifications';
    }
    if (userAgent.includes('Firefox/')) {
        return 'about:preferences#privacy';
    }
    return 'chrome://settings/content/notifications';
}

export interface NotificationSettingsHelp {
    readonly platform: 'android' | 'ios' | 'desktop' | 'insecure' | 'webview';
    readonly title: string;
    readonly intentUrl?: string;
    readonly settingsUrl?: string;
    readonly httpsUrl?: string;
    readonly certUrl?: string;
    readonly steps: readonly string[];
}

// browsers remove the Notification API on plain-http origins (except localhost),
// so the site can never appear in the allow lists — the only fix is the HTTPS URL
export function insecureContextHelp(httpsUrl: string | null): NotificationSettingsHelp {
    return {
        platform: 'insecure',
        title: 'Notifications need HTTPS',
        httpsUrl: httpsUrl ?? undefined,
        steps: [
            'This page is on plain HTTP, so the browser hides notifications for it entirely — it will never show up in the allow list',
            httpsUrl
                ? 'Open the HTTPS version below (with the self-signed certificate: tap Advanced → Proceed, or trust the cert on your device)'
                : 'Open the HTTPS URL of this server (or a Tailscale/HTTPS proxy) and enable notifications there',
            'Then toggle the bell again from the HTTPS page',
        ],
    };
}

// in-app browsers (the herdr-web Android shell, chat apps, …) embed a WebView
// that has no Notification API at all: HTTPS and trusted certificates are fine,
// the API is simply absent. The only fix is the system browser.
export function webviewHelp(httpsUrl: string): NotificationSettingsHelp {
    return {
        platform: 'webview',
        title: '内置浏览器不支持系统通知',
        httpsUrl,
        steps: [
            '当前页面在 App 的内置浏览器（WebView）里，它没有系统通知能力——与 HTTPS/证书无关',
            '复制下面的地址，在系统浏览器（Chrome）中打开',
            '在 Chrome 里点右上角铃铛开启通知；需要常驻可再「添加到主屏幕」当 PWA 用',
        ],
    };
}

// permission is granted but the browser refused to register the service worker —
// on a non-localhost secure origin that means the TLS certificate isn't trusted,
// so background push is off and only page-open notifications work
export function untrustedCertHelp(userAgent: string): NotificationSettingsHelp {
    const isAndroid = /Android/.test(userAgent);
    return {
        platform: 'insecure',
        title: 'Push needs a trusted certificate',
        certUrl: '/cert',
        steps: [
            'Notifications work while this page is open, but background push is blocked: the HTTPS certificate is self-signed and this device does not trust it, so the browser refuses to register the service worker',
            isAndroid
                ? 'Tap "Download certificate" below, then Android Settings → Security → More security settings → Install a certificate → CA certificate → pick herdr-web.crt'
                : 'Tap "Download certificate" below and trust it (macOS: double-click it in Keychain Access → Trust → Always Trust; Windows: install to "Trusted Root Certification Authorities")',
            'Easiest alternative: use Tailscale (`tailscale serve <port>`) — it gives a properly trusted HTTPS URL with zero certificate work',
            'Then reload and toggle the bell again',
        ],
    };
}

// Android Chrome/Edge honor intent: URLs on a user tap, which CAN open the OS
// notification settings for the browser app — the one real escape hatch a page has
export function notificationSettingsHelp(userAgent: string): NotificationSettingsHelp {
    if (/iPhone|iPad|iPod/.test(userAgent)) {
        return {
            platform: 'ios',
            title: 'Notifications are blocked',
            steps: [
                'Open the iOS Settings app',
                'Notifications → find this app (or Safari) and allow notifications',
                'If installed from Safari: notifications need iOS 16.4+ and the app added to the Home Screen',
            ],
        };
    }
    if (/Android/.test(userAgent)) {
        const browserPackage = userAgent.includes('Edg') ? 'com.microsoft.emmx' : 'com.android.chrome';
        return {
            platform: 'android',
            title: 'Notifications are blocked',
            intentUrl: `intent:#Intent;action=android.settings.APP_NOTIFICATION_SETTINGS;S.android.provider.extra.APP_PACKAGE=${browserPackage};end`,
            steps: [
                'Tap "Open notification settings" below and allow notifications for the browser',
                'Then in the browser: tap the lock/tune icon next to the address → Permissions → Notifications → Allow',
            ],
        };
    }
    return {
        platform: 'desktop',
        title: 'Notifications are blocked',
        settingsUrl: browserNotificationSettingsUrl(userAgent),
        steps: [
            'Easiest: click the lock/tune icon next to the address → Site settings → Notifications → Allow',
            'Or copy the settings address below, open it in a new tab, and add/allow this site (a site only appears in the list after it has asked once)',
        ],
    };
}

export function toastClass(event: AgentEvent): string {
    if (event.to === 'blocked') {
        return 'toast toast-blocked';
    }
    if (event.from === 'working') {
        return 'toast toast-done';
    }
    return 'toast';
}
