import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HerdrSocket } from './ws-client';
import type { ClientMessage } from '../types';

class MockWebSocket {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSING = 2;
    static readonly CLOSED = 3;
    static instances: MockWebSocket[] = [];

    readyState = 0;
    onopen: (() => void) | null = null;
    onmessage: ((event: MessageEvent<string>) => void) | null = null;
    onclose: (() => void) | null = null;
    onerror: (() => void) | null = null;
    readonly sent: string[] = [];
    closeCalls = 0;

    constructor(readonly url: string) {
        MockWebSocket.instances.push(this);
    }

    send(data: string): void {
        this.sent.push(data);
    }

    close(): void {
        this.closeCalls += 1;
    }
}

function latestSocket(): MockWebSocket {
    const instance = MockWebSocket.instances.at(-1);
    if (!instance) {
        throw new Error('no WebSocket was created');
    }
    return instance;
}

function makeMessageEvent(data: string): MessageEvent<string> {
    return { data } as unknown as MessageEvent<string>;
}

function makeClient() {
    const onMessage = vi.fn();
    const onStatusChange = vi.fn();
    const onStateChange = vi.fn();
    const client = new HerdrSocket('ws://localhost:8123/ws', onMessage, onStatusChange, onStateChange);
    return { client, onMessage, onStatusChange, onStateChange };
}

describe('HerdrSocket', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        MockWebSocket.instances = [];
        vi.stubGlobal('WebSocket', MockWebSocket);
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });

    it('connect() opens a websocket to the given url', () => {
        const { client } = makeClient();
        client.connect();
        expect(MockWebSocket.instances).toHaveLength(1);
        expect(latestSocket().url).toBe('ws://localhost:8123/ws');
    });

    it('reports connected on open and disconnected on close', () => {
        const { client, onStatusChange } = makeClient();
        client.connect();
        latestSocket().onopen?.();
        expect(onStatusChange).toHaveBeenLastCalledWith(true);
        latestSocket().onclose?.();
        expect(onStatusChange).toHaveBeenLastCalledWith(false);
    });

    it('schedules the first reconnect at 1000ms after close', () => {
        const { client } = makeClient();
        client.connect();
        latestSocket().onclose?.();
        vi.advanceTimersByTime(999);
        expect(MockWebSocket.instances).toHaveLength(1);
        vi.advanceTimersByTime(1);
        expect(MockWebSocket.instances).toHaveLength(2);
    });

    it('first retry delay is exactly 1000ms', () => {
        const { client } = makeClient();
        client.connect();
        latestSocket().onclose?.();
        vi.advanceTimersByTime(999);
        expect(MockWebSocket.instances).toHaveLength(1);
        vi.advanceTimersByTime(1);
        expect(MockWebSocket.instances).toHaveLength(2);
    });

    it('doubles the reconnect delay on repeated failures, capped at 30000ms', () => {
        const { client } = makeClient();
        client.connect();
        const delays = [1000, 2000, 4000, 8000, 16000, 30000, 30000];
        for (const delay of delays) {
            const before = MockWebSocket.instances.length;
            latestSocket().onclose?.();
            vi.advanceTimersByTime(delay - 1);
            expect(MockWebSocket.instances).toHaveLength(before);
            vi.advanceTimersByTime(1);
            expect(MockWebSocket.instances).toHaveLength(before + 1);
        }
    });

    it('emits connecting, open and reconnecting connection states', () => {
        const { client, onStateChange } = makeClient();
        client.connect();
        expect(onStateChange).toHaveBeenLastCalledWith('connecting');
        latestSocket().onopen?.();
        expect(onStateChange).toHaveBeenLastCalledWith('open');
        latestSocket().onclose?.();
        expect(onStateChange).toHaveBeenLastCalledWith('reconnecting');
    });

    it('cleans up a stale socket before opening a new connection', () => {
        const { client } = makeClient();
        client.connect();
        const first = latestSocket();
        client.connect();
        expect(first.closeCalls).toBe(1);
        expect(MockWebSocket.instances).toHaveLength(2);
        expect(latestSocket()).not.toBe(first);
    });

    it('detaches every handler and closes the socket on close()', () => {
        const { client } = makeClient();
        client.connect();
        const socket = latestSocket();
        client.close();
        expect(socket.closeCalls).toBe(1);
        expect(socket.onopen).toBeNull();
        expect(socket.onmessage).toBeNull();
        expect(socket.onclose).toBeNull();
        expect(socket.onerror).toBeNull();
    });

    it('closes the errored socket and reconnects only once after onerror', () => {
        const { client } = makeClient();
        client.connect();
        const first = latestSocket();
        first.onerror?.();
        expect(first.closeCalls).toBe(1);
        // browsers fire onclose right after onerror: must not schedule a second reconnect
        first.onclose?.();
        vi.advanceTimersByTime(1000);
        expect(MockWebSocket.instances).toHaveLength(2);
    });

    it('pauses the backoff while hidden and retries immediately once visible', () => {
        const { client } = makeClient();
        client.connect();
        latestSocket().onclose?.();
        client.pauseReconnect();
        vi.advanceTimersByTime(60000);
        expect(MockWebSocket.instances).toHaveLength(1);
        client.resumeReconnect();
        expect(MockWebSocket.instances).toHaveLength(2);
    });

    it('resumeReconnect() does not open a second socket while one is live', () => {
        const { client } = makeClient();
        client.connect();
        latestSocket().readyState = MockWebSocket.OPEN;
        client.resumeReconnect();
        expect(MockWebSocket.instances).toHaveLength(1);
    });

    it('stops auto-reconnecting after the attempt limit and reports failed', () => {
        const { client, onStatusChange, onStateChange } = makeClient();
        client.connect();
        for (let attempt = 0; attempt < HerdrSocket.MAX_RECONNECT_ATTEMPTS; attempt += 1) {
            latestSocket().onclose?.();
            vi.advanceTimersByTime(HerdrSocket.RECONNECT_MAX_MS);
        }
        const created = MockWebSocket.instances.length;
        latestSocket().onclose?.();
        vi.advanceTimersByTime(HerdrSocket.RECONNECT_MAX_MS * 10);
        expect(MockWebSocket.instances).toHaveLength(created);
        expect(onStateChange).toHaveBeenLastCalledWith('failed');
        expect(onStatusChange).toHaveBeenLastCalledWith(false);
        // a foreground event must not sneak past the failure limit either
        client.resumeReconnect();
        expect(MockWebSocket.instances).toHaveLength(created);
    });

    it('resets the backoff after a successful open', () => {
        const { client } = makeClient();
        client.connect();
        latestSocket().onclose?.();
        vi.advanceTimersByTime(1000);
        expect(MockWebSocket.instances).toHaveLength(2);
        latestSocket().onopen?.();
        latestSocket().onclose?.();
        vi.advanceTimersByTime(1000);
        expect(MockWebSocket.instances).toHaveLength(3);
    });

    it('close() during backoff cancels the pending reconnect', () => {
        const { client } = makeClient();
        client.connect();
        latestSocket().onclose?.();
        client.close();
        vi.advanceTimersByTime(60000);
        expect(MockWebSocket.instances).toHaveLength(1);
    });

    it('never reconnects after close(), even if the socket closes afterwards', () => {
        const { client } = makeClient();
        client.connect();
        const socket = latestSocket();
        client.close();
        expect(socket.closeCalls).toBe(1);
        socket.onclose?.();
        vi.advanceTimersByTime(60000);
        expect(MockWebSocket.instances).toHaveLength(1);
    });

    it('send() no-ops when the socket is not open', () => {
        const { client } = makeClient();
        client.connect();
        client.send({ type: 'refresh_topology' });
        expect(latestSocket().sent).toHaveLength(0);
    });

    it('send() serializes the message as JSON when the socket is open', () => {
        const { client } = makeClient();
        client.connect();
        const socket = latestSocket();
        socket.readyState = MockWebSocket.OPEN;
        const message: ClientMessage = { type: 'input', data: 'ls' };
        client.send(message);
        expect(socket.sent).toEqual([JSON.stringify(message)]);
    });

    it('ignores malformed server messages without throwing', () => {
        const { client, onMessage } = makeClient();
        client.connect();
        expect(() => latestSocket().onmessage?.(makeMessageEvent('not json'))).not.toThrow();
        expect(onMessage).not.toHaveBeenCalled();
    });

    it('parses well-formed server messages', () => {
        const { client, onMessage } = makeClient();
        client.connect();
        latestSocket().onmessage?.(makeMessageEvent('{"type":"error","message":"boom"}'));
        expect(onMessage).toHaveBeenCalledWith({ type: 'error', message: 'boom' });
    });
});
