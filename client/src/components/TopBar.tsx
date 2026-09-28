import type { ConnectionState } from '../lib/ws-client';
import { statusDotClass } from '../lib/status';
import type { HerdrPane } from '../types';

interface TopBarProps {
    readonly connected: boolean;
    readonly status: ConnectionState;
    readonly panes: HerdrPane[];
    readonly notificationsEnabled: boolean;
    readonly onOpenSettings: () => void;
}

const STATUS_TEXT: Readonly<Record<ConnectionState, string>> = {
    connecting: 'Connecting…',
    open: 'Connected',
    reconnecting: 'Connection lost, reconnecting…',
    failed: 'Connection failed, please refresh the page',
};

const STATUS_COLOR: Readonly<Record<ConnectionState, string>> = {
    connecting: 'var(--accent)',
    open: 'var(--idle)',
    reconnecting: 'var(--working)',
    failed: 'var(--blocked)',
};

export function TopBar({ connected, status, panes, notificationsEnabled, onOpenSettings }: TopBarProps) {
    const color = STATUS_COLOR[status];
    return (
        <>
            <header className="topbar">
                <div className="topbar-title">
                    <span className="brand">herdr</span>
                    <span className="brand-dim">/web</span>
                    <span className={connected ? 'conn-dot online' : 'conn-dot'} title={connected ? 'connected' : 'disconnected'} />
                </div>
                <div className="herd-strip" aria-label="agent states">
                    {panes.map((pane) => (
                        <span key={pane.pane_id} className={`herd-dot ${statusDotClass(pane.agent_status)}`} title={pane.terminal_title_stripped ?? pane.pane_id} />
                    ))}
                </div>
                <button
                    type="button"
                    className="icon-btn"
                    aria-haspopup="dialog"
                    aria-pressed={notificationsEnabled}
                    aria-label="Notification settings"
                    title="Notification settings"
                    onClick={onOpenSettings}
                >
                    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
                        <path d="M13.7 21a2 2 0 0 1-3.4 0" />
                    </svg>
                </button>
            </header>
            <div
                role="status"
                aria-live="polite"
                title={STATUS_TEXT[status]}
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '2px 14px',
                    fontFamily: 'var(--mono)',
                    fontSize: '12px',
                    lineHeight: '16px',
                    color,
                    background: 'var(--panel-raised)',
                    borderBottom: '1px solid var(--border)',
                }}
            >
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: color, flex: '0 0 auto' }} />
                <span>{STATUS_TEXT[status]}</span>
            </div>
        </>
    );
}
