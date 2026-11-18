import { appUrl } from './base';
// VAPID application server keys arrive base64url-encoded; PushManager wants raw bytes
export function urlBase64ToUint8Array(base64Url: string): Uint8Array {
    const padding = '='.repeat((4 - (base64Url.length % 4)) % 4);
    const base64 = (base64Url + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(base64);
    const output = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i += 1) {
        output[i] = raw.charCodeAt(i);
    }
    return output;
}

export type PushSubscribeFailure = 'no-service-worker' | 'no-push-manager';

const SERVICE_WORKER_READY_TIMEOUT_MS = 8000;

// the service worker registers asynchronously on page load — a bell tap right
// after the first visit must wait for activation, not read a racy getRegistration()
async function waitForServiceWorker(): Promise<ServiceWorkerRegistration | null> {
    if (!('serviceWorker' in navigator)) {
        return null;
    }
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), SERVICE_WORKER_READY_TIMEOUT_MS));
    return Promise.race([navigator.serviceWorker.ready, timeout]);
}

export async function subscribeToPush(allChanges = false): Promise<PushSubscription | PushSubscribeFailure> {
    const registration = await waitForServiceWorker();
    if (!registration) {
        // ready never resolving on a secure origin almost always means the TLS
        // cert isn't trusted, so the browser refused to register the worker
        return 'no-service-worker';
    }
    if (!('pushManager' in registration)) {
        return 'no-push-manager';
    }
    const keyResponse = await fetch(appUrl('push/public-key'));
    const { publicKey } = (await keyResponse.json()) as { publicKey: string };
    const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
    });
    await fetch(appUrl('push/subscribe'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // the verbosity preference rides along: background push is filtered on the
        // server, which has no other way to know what this device asked for
        body: JSON.stringify({ ...subscription.toJSON(), allChanges }),
    });
    return subscription;
}

export async function unsubscribeFromPush(): Promise<void> {
    const registration = await waitForServiceWorker();
    const subscription = await registration?.pushManager?.getSubscription();
    if (!subscription) {
        return;
    }
    await fetch(appUrl('push/unsubscribe'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: subscription.endpoint }),
    });
    await subscription.unsubscribe();
}
