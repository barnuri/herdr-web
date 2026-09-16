import type { ClientMessage, ServerMessage } from '../types';

export type ConnectionState = 'connecting' | 'open' | 'reconnecting' | 'failed';

export class HerdrSocket {
    static readonly RECONNECT_BASE_MS = 1000;
    static readonly RECONNECT_MAX_MS = 30000;
    static readonly MAX_RECONNECT_ATTEMPTS = 10;

    private socket: WebSocket | null = null;
    private reconnectAttempts = 0;
    private closedByUser = false;
    private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    private paused = false;
    private failed = false;
    private state: ConnectionState | null = null;
    private generation = 0;

    constructor(
        private readonly url: string,
        private readonly onMessage: (message: ServerMessage) => void,
        private readonly onStatusChange: (connected: boolean) => void,
        private readonly onStateChange?: (state: ConnectionState) => void,
    ) {}

    connect(): void {
        this.closedByUser = false;
        this.failed = false;
        this.paused = false;
        this.reconnectAttempts = 0;
        this.emitState('connecting');
        this.open();
    }

    close(): void {
        this.closedByUser = true;
        this.clearReconnectTimer();
        this.disposeSocket();
    }

    /** Pause the backoff timer while the page is in the background. */
    pauseReconnect(): void {
        if (this.closedByUser) {
            return;
        }
        this.paused = true;
        this.clearReconnectTimer();
    }

    /** Resume after the page comes back: retry immediately instead of waiting out the backoff. */
    resumeReconnect(): void {
        if (this.closedByUser || this.failed) {
            return;
        }
        this.paused = false;
        if (this.socket !== null) {
            const readyState = this.socket.readyState;
            if (readyState === WebSocket.OPEN || readyState === WebSocket.CONNECTING) {
                return;
            }
        }
        this.clearReconnectTimer();
        this.open();
    }

    send(message: ClientMessage): void {
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
            return;
        }
        this.socket.send(JSON.stringify(message));
    }

    private open(): void {
        if (this.closedByUser || this.failed) {
            return;
        }
        // never let a stale socket or a pending timer overlap the new connection
        this.clearReconnectTimer();
        this.disposeSocket();

        const socket = new WebSocket(this.url);
        this.socket = socket;
        this.generation += 1;
        const generation = this.generation;
        let disconnectHandled = false;

        this.emitState(this.reconnectAttempts > 0 ? 'reconnecting' : 'connecting');

        const handleDisconnect = () => {
            if (disconnectHandled) {
                return;
            }
            disconnectHandled = true;
            if (generation !== this.generation) {
                return;
            }
            if (this.socket === socket) {
                this.socket = null;
            }
            if (this.closedByUser) {
                return;
            }
            this.onStatusChange(false);
            this.scheduleReconnect();
        };

        socket.onopen = () => {
            if (generation !== this.generation) {
                return;
            }
            this.reconnectAttempts = 0;
            this.failed = false;
            this.onStatusChange(true);
            this.emitState('open');
        };
        socket.onmessage = (raw: MessageEvent<string>) => {
            if (generation !== this.generation) {
                return;
            }
            try {
                this.onMessage(JSON.parse(raw.data) as ServerMessage);
            } catch (err) {
                if (err instanceof Error) {
                    console.error('bad server message:', err.message);
                }
            }
        };
        socket.onclose = handleDisconnect;
        socket.onerror = () => {
            socket.close();
            handleDisconnect();
        };
    }

    private scheduleReconnect(): void {
        if (this.closedByUser || this.failed) {
            return;
        }
        if (this.paused) {
            this.emitState('reconnecting');
            return;
        }
        if (this.reconnectAttempts >= HerdrSocket.MAX_RECONNECT_ATTEMPTS) {
            this.failed = true;
            this.onStatusChange(false);
            this.emitState('failed');
            return;
        }
        // attempts is 0-based here: the first backoff is BASE_MS * 2**0 = 1000ms.
        const delay = Math.min(
            HerdrSocket.RECONNECT_BASE_MS * 2 ** this.reconnectAttempts,
            HerdrSocket.RECONNECT_MAX_MS,
        );
        this.reconnectAttempts += 1;
        this.emitState('reconnecting');
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this.open();
        }, delay);
    }

    private clearReconnectTimer(): void {
        if (this.reconnectTimer !== null) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
    }

    private disposeSocket(): void {
        const socket = this.socket;
        if (!socket) {
            return;
        }
        this.socket = null;
        socket.onopen = null;
        socket.onmessage = null;
        socket.onclose = null;
        socket.onerror = null;
        try {
            socket.close();
        } catch {
            // closing an already-closed socket is harmless
        }
    }

    private emitState(state: ConnectionState): void {
        if (this.state === state) {
            return;
        }
        this.state = state;
        this.onStateChange?.(state);
    }
}
