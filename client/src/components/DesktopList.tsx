import { statusDotClass } from '../lib/status';
import type { DesktopSpace, DesktopTerminal } from '../lib/desktop';

interface DesktopListProps {
    readonly connected: boolean;
    readonly world: readonly DesktopSpace[] | null;
    readonly onAttach: (terminal: string) => void;
    readonly onRun: (space: string, tab: string, cwd: string | null) => void;
    readonly onKill: (terminal: DesktopTerminal) => void;
}

/** The desktop app's spaces and tabs, each terminal with its agent status. */
export function DesktopList({ connected, world, onAttach, onRun, onKill }: DesktopListProps) {
    if (world === null) {
        return <div className="desktop-list desktop-empty">{connected ? 'Loading terminals…' : 'Connecting to hc…'}</div>;
    }
    if (world.length === 0) {
        return <div className="desktop-list desktop-empty">No live hc terminals. Is the herdr desktop app running?</div>;
    }
    return (
        <div className="desktop-list" aria-label="Desktop terminals">
            {world.map((space) => (
                <section key={space.id ?? 'none'} className="desktop-space">
                    <h2 className="desktop-space-name" title={space.folder ?? undefined}>
                        {space.name}
                    </h2>
                    {space.tabs.map((tab) => {
                        const spaceId = space.id;
                        const tabId = tab.id;
                        return (
                        <div key={tabId ?? 'none'} className="desktop-tab">
                            <div className="desktop-tab-head">
                                <span className="desktop-tab-name">{tab.name}</span>
                                {spaceId !== null && tabId !== null && (
                                    <button
                                        type="button"
                                        className="desktop-btn"
                                        title="New terminal in this tab"
                                        aria-label={`New terminal in ${space.name} / ${tab.name}`}
                                        onClick={() => onRun(spaceId, tabId, space.folder)}
                                    >
                                        + new
                                    </button>
                                )}
                            </div>
                            {tab.terminals.length === 0 && <div className="desktop-none">no terminals</div>}
                            {tab.terminals.map((terminal) => (
                                <div key={terminal.address} className="desktop-terminal">
                                    <button type="button" className="desktop-terminal-open" onClick={() => onAttach(terminal.address)}>
                                        <span className={`herd-dot ${statusDotClass(terminal.status)}`} />
                                        <span className="desktop-terminal-title">{terminal.title}</span>
                                        <span className="desktop-terminal-meta">
                                            {[terminal.agent, terminal.status, terminal.address].filter(Boolean).join(' · ')}
                                        </span>
                                    </button>
                                    <button
                                        type="button"
                                        className="desktop-btn desktop-btn-danger"
                                        aria-label={`Close ${terminal.title}`}
                                        title="Close terminal"
                                        onClick={() => onKill(terminal)}
                                    >
                                        ✕
                                    </button>
                                </div>
                            ))}
                        </div>
                        );
                    })}
                </section>
            ))}
        </div>
    );
}

interface DesktopBarProps {
    readonly terminal: string;
    readonly onDetach: () => void;
    readonly onKill: () => void;
}

/** Shown above an attached desktop terminal. */
export function DesktopBar({ terminal, onDetach, onKill }: DesktopBarProps) {
    return (
        <div className="desktop-bar">
            <button type="button" className="desktop-btn" onClick={onDetach}>
                ← terminals
            </button>
            <span className="desktop-bar-name">{terminal}</span>
            <button type="button" className="desktop-btn desktop-btn-danger" onClick={onKill}>
                close
            </button>
        </div>
    );
}
