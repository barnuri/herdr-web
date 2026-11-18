import { useCallback, useEffect, useRef, useState } from 'react';
import { withEnv } from '../lib/envs';
import { HerdrSocket } from '../lib/ws-client';
import type { ConnectionState } from '../lib/ws-client';
import type { AgentEvent, ClientMessage, HerdrPane, HerdrWorkspace, ServerMessage } from '../types';
import { appUrl } from '../lib/base';

export type TerminalMessage =
    | { type: 'output'; data: string }
    | { type: 'exit'; code: number }
    | { type: 'clipboard'; text: string };

export interface HerdrState {
    readonly connected: boolean;
    readonly status: ConnectionState;
    readonly workspaces: HerdrWorkspace[];
    readonly panes: HerdrPane[];
    readonly lastEvent: AgentEvent | null;
    readonly lastError: string | null;
    readonly send: (message: ClientMessage) => void;
    readonly subscribeTerminal: (handler: (message: TerminalMessage) => void) => () => void;
}

export function useHerdrSocket(envId: string, enabled = true): HerdrState {
    const [connected, setConnected] = useState(false);
    const [status, setStatus] = useState<ConnectionState>('connecting');
    const [workspaces, setWorkspaces] = useState<HerdrWorkspace[]>([]);
    const [panes, setPanes] = useState<HerdrPane[]>([]);
    const [lastEvent, setLastEvent] = useState<AgentEvent | null>(null);
    const [lastError, setLastError] = useState<string | null>(null);
    const socketRef = useRef<HerdrSocket | null>(null);
    const terminalHandlersRef = useRef(new Set<(message: TerminalMessage) => void>());

    useEffect(() => {
        if (!enabled) {
            return undefined;
        }
        // nothing from the previous env may stay on screen while the new one connects
        setConnected(false);
        setStatus('connecting');
        setWorkspaces([]);
        setPanes([]);
        setLastEvent(null);
        setLastError(null);
        const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
        const device = window.matchMedia('(pointer: coarse)').matches ? 'mobile' : 'desktop';
        const url = withEnv(`${protocol}://${window.location.host}${appUrl('ws')}?device=${device}`, envId);
        const socket = new HerdrSocket(
            url,
            (message: ServerMessage) => {
                if (message.type === 'output' || message.type === 'exit' || message.type === 'clipboard') {
                    for (const handler of terminalHandlersRef.current) {
                        handler(message);
                    }
                    return;
                }
                if (message.type === 'topology') {
                    setWorkspaces(message.workspaces);
                    setPanes(message.panes);
                    return;
                }
                if (message.type === 'agent_event') {
                    setLastEvent(message.event);
                    return;
                }
                setLastError(message.message);
            },
            setConnected,
            (next: ConnectionState) => setStatus(next),
        );
        socketRef.current = socket;

        // Backoff is paused while the tab is hidden so we don't hammer a dead
        // network, and the moment the user returns we retry right away.
        const onVisibilityChange = () => {
            if (document.visibilityState === 'hidden') {
                socket.pauseReconnect();
            } else {
                socket.resumeReconnect();
            }
        };
        document.addEventListener('visibilitychange', onVisibilityChange);

        socket.connect();
        return () => {
            document.removeEventListener('visibilitychange', onVisibilityChange);
            socketRef.current = null;
            socket.close();
        };
    }, [envId, enabled]);

    const send = useCallback((message: ClientMessage) => {
        socketRef.current?.send(message);
    }, []);

    const subscribeTerminal = useCallback((handler: (message: TerminalMessage) => void) => {
        terminalHandlersRef.current.add(handler);
        return () => {
            terminalHandlersRef.current.delete(handler);
        };
    }, []);

    return { connected, status, workspaces, panes, lastEvent, lastError, send, subscribeTerminal };
}
