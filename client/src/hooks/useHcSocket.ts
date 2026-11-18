import { useCallback, useEffect, useRef, useState } from 'react';
import { groupWorld, WORLD_POLL_MS } from '../lib/desktop';
import type { AppSpace, DesktopSpace, HcTerminal } from '../lib/desktop';
import type { ClientMessage } from '../types';
import type { TerminalMessage } from './useHerdrSocket';

const RECONNECT_MS = 2000;

type HcServerMessage =
    | { type: 'world'; spaces: AppSpace[] | null; terminals: HcTerminal[] }
    | { type: 'attached'; terminal: string }
    | { type: 'output'; data: string }
    | { type: 'detached'; code: number }
    | { type: 'ran'; terminal: string }
    | { type: 'killed'; terminal: string }
    | { type: 'error'; message: string; request?: string };

export interface HcState {
    readonly connected: boolean;
    /** Null until the first answer arrives. */
    readonly world: DesktopSpace[] | null;
    readonly attached: string | null;
    readonly lastError: string | null;
    /** Takes the TUI client's messages, so XTermView drives an hc terminal unchanged. */
    readonly send: (message: ClientMessage) => void;
    readonly subscribeTerminal: (handler: (message: TerminalMessage) => void) => () => void;
    readonly attach: (terminal: string) => void;
    readonly detach: () => void;
    readonly run: (space: string, tab: string, cwd: string | null) => void;
    readonly kill: (terminal: string) => void;
}

// The bridge lives at /ws/hc, outside the client's /tui/ base.
function bridgeUrl(): string {
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    return `${protocol}://${window.location.host}/ws/hc`;
}

export function useHcSocket(enabled: boolean): HcState {
    const [connected, setConnected] = useState(false);
    const [world, setWorld] = useState<DesktopSpace[] | null>(null);
    const [attached, setAttached] = useState<string | null>(null);
    const [lastError, setLastError] = useState<string | null>(null);
    const socketRef = useRef<WebSocket | null>(null);
    const attachedRef = useRef<string | null>(null);
    const handlersRef = useRef(new Set<(message: TerminalMessage) => void>());

    const setAttachedBoth = (terminal: string | null) => {
        attachedRef.current = terminal;
        setAttached(terminal);
    };

    const raw = useCallback((payload: object) => {
        const socket = socketRef.current;
        if (socket?.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify(payload));
        }
    }, []);

    useEffect(() => {
        if (!enabled) {
            return undefined;
        }
        let disposed = false;
        let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
        let pollTimer: ReturnType<typeof setInterval> | null = null;

        const onMessage = (message: HcServerMessage) => {
            switch (message.type) {
                case 'world':
                    setWorld(groupWorld(message.spaces, message.terminals));
                    return;
                case 'output':
                    for (const handler of handlersRef.current) {
                        handler(message);
                    }
                    return;
                case 'detached':
                    setAttachedBoth(null);
                    return;
                case 'ran':
                    setAttachedBoth(message.terminal);
                    raw({ type: 'world' });
                    return;
                case 'killed':
                    if (attachedRef.current === message.terminal) {
                        setAttachedBoth(null);
                    }
                    raw({ type: 'world' });
                    return;
                case 'error':
                    setLastError(message.message);
                    if (message.request === 'attach') {
                        setAttachedBoth(null);
                    }
                    return;
                default:
            }
        };

        const open = () => {
            const socket = new WebSocket(bridgeUrl());
            socketRef.current = socket;
            socket.onopen = () => {
                setConnected(true);
                socket.send(JSON.stringify({ type: 'world' }));
            };
            socket.onmessage = (event: MessageEvent<string>) => {
                try {
                    onMessage(JSON.parse(event.data) as HcServerMessage);
                } catch (error) {
                    console.warn('herdr-web: unreadable hc bridge message', error);
                }
            };
            socket.onclose = () => {
                setConnected(false);
                if (!disposed) {
                    reconnectTimer = setTimeout(open, RECONNECT_MS);
                }
            };
        };

        open();
        pollTimer = setInterval(() => {
            if (document.visibilityState === 'visible') {
                raw({ type: 'world' });
            }
        }, WORLD_POLL_MS);
        return () => {
            disposed = true;
            if (reconnectTimer !== null) {
                clearTimeout(reconnectTimer);
            }
            if (pollTimer !== null) {
                clearInterval(pollTimer);
            }
            socketRef.current?.close();
            socketRef.current = null;
            setConnected(false);
        };
    }, [enabled, raw]);

    const send = useCallback(
        (message: ClientMessage) => {
            if (message.type === 'start') {
                if (attachedRef.current !== null) {
                    raw({ type: 'attach', terminal: attachedRef.current, cols: message.cols, rows: message.rows });
                }
                return;
            }
            if (message.type === 'input' || message.type === 'resize') {
                raw(message);
            }
        },
        [raw],
    );

    const subscribeTerminal = useCallback((handler: (message: TerminalMessage) => void) => {
        handlersRef.current.add(handler);
        return () => {
            handlersRef.current.delete(handler);
        };
    }, []);

    const attach = useCallback((terminal: string) => {
        setLastError(null);
        setAttachedBoth(terminal);
    }, []);

    const detach = useCallback(() => {
        raw({ type: 'detach' });
        setAttachedBoth(null);
    }, [raw]);

    const run = useCallback(
        (space: string, tab: string, cwd: string | null) => raw({ type: 'run', space, tab, ...(cwd ? { cwd } : {}) }),
        [raw],
    );

    const kill = useCallback((terminal: string) => raw({ type: 'kill', terminal }), [raw]);

    return { connected, world, attached, lastError, send, subscribeTerminal, attach, detach, run, kill };
}
