import { useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import type { ArmedModifier } from '../lib/modifier-keys';
import { readQuickKeysCollapsed, writeQuickKeysCollapsed } from '../lib/quick-keys-collapsed';

interface QuickKey {
    readonly label: string;
    readonly bytes: string;
    readonly title: string;
    readonly danger?: boolean;
}

// grouped so the bar stays scannable as it wraps (desktop) or scrolls (phone).
// order is by reach, not by category: on a phone the bar is one scrolling row,
// so the keys you need mid-run (enter, ctrl+c) lead and F-keys trail.
const QUICK_KEY_GROUPS: ReadonlyArray<ReadonlyArray<QuickKey>> = [
    [
        { label: 'prefix', bytes: '\x01', title: 'herdr prefix (ctrl+a) — starts a herdr command' },
        { label: 'esc', bytes: '\x1b', title: 'Escape' },
        { label: 'tab', bytes: '\t', title: 'Tab — complete' },
        { label: '⇧tab', bytes: '\x1b[Z', title: 'Shift+Tab — complete backwards' },
        { label: 'enter', bytes: '\r', title: 'Enter' },
    ],
    [
        { label: 'ctrl·c', bytes: '\x03', title: 'Interrupt the running command', danger: true },
        {
            label: 'ctrl·c·c',
            bytes: '\x03\x03',
            title: 'Double Ctrl+C — quits agents that require a second interrupt',
            danger: true,
        },
        { label: 'ctrl·d', bytes: '\x04', title: 'End of input — exits the shell on an empty line', danger: true },
        { label: 'ctrl·z', bytes: '\x1a', title: 'Suspend the running command', danger: true },
    ],
    [
        { label: '↑', bytes: '\x1b[A', title: 'Up' },
        { label: '↓', bytes: '\x1b[B', title: 'Down' },
        { label: '←', bytes: '\x1b[D', title: 'Left' },
        { label: '→', bytes: '\x1b[C', title: 'Right' },
        { label: 'pgup', bytes: '\x1b[5~', title: 'Page Up' },
        { label: 'pgdn', bytes: '\x1b[6~', title: 'Page Down' },
        { label: 'home', bytes: '\x1b[H', title: 'Home — start of line' },
        { label: 'end', bytes: '\x1b[F', title: 'End — end of line' },
    ],
    [
        { label: 'bksp', bytes: '\x7f', title: 'Backspace' },
        { label: 'del', bytes: '\x1b[3~', title: 'Delete forward' },
        { label: 'alt·enter', bytes: '\x1b\r', title: 'Alt+Enter — newline without submitting' },
    ],
    [
        { label: 'ctrl·u', bytes: '\x15', title: 'Clear the line before the cursor' },
        { label: 'ctrl·w', bytes: '\x17', title: 'Delete the word before the cursor' },
        { label: 'ctrl·l', bytes: '\x0c', title: 'Clear the screen' },
        { label: 'ctrl·r', bytes: '\x12', title: 'Search command history' },
    ],
    [
        { label: 'F1', bytes: '\x1bOP', title: 'F1' },
        { label: 'F2', bytes: '\x1bOQ', title: 'F2' },
        { label: 'F3', bytes: '\x1bOR', title: 'F3' },
        { label: 'F4', bytes: '\x1bOS', title: 'F4' },
    ],
];

// a 30-key bar costs terminal rows that matter more on a phone, so touch devices
// start collapsed; a pointer device has the room and starts expanded
const HAS_COARSE_POINTER = window.matchMedia('(pointer: coarse)').matches;

const MODIFIER_KEYS: ReadonlyArray<{ modifier: ArmedModifier; label: string }> = [
    { modifier: 'ctrl', label: 'ctrl' },
    { modifier: 'alt', label: 'alt' },
];

// what survives a collapse: the keys needed mid-run, taken from the groups above
// rather than redeclared, so a byte sequence is only ever defined once.
// ordered like web-terminal's always-visible bar, herdr-only keys trailing.
// ctrl, alt, img, cam and paste stay visible in either state, so they aren't repeated here.
const COLLAPSED_KEY_LABELS: readonly string[] = [
    'tab',
    'esc',
    'ctrl·c',
    'home',
    'end',
    '←',
    '↑',
    '↓',
    '→',
    'ctrl·c·c',
    'enter',
    'prefix',
    'F1',
];
const COLLAPSED_KEYS: readonly QuickKey[] = COLLAPSED_KEY_LABELS.map((label) => {
    const key = QUICK_KEY_GROUPS.flat().find((candidate) => candidate.label === label);
    // a typo here would silently drop a key from the collapsed bar, so fail at load
    if (!key) {
        throw new Error(`collapsed quick key "${label}" is not defined in QUICK_KEY_GROUPS`);
    }
    return key;
});

interface ComposerProps {
    readonly disabled: boolean;
    readonly keyboardEnabled: boolean;
    readonly armedModifier: ArmedModifier | null;
    readonly onToggleKeyboard: () => void;
    readonly onToggleModifier: (modifier: ArmedModifier) => void;
    readonly onSendBytes: (bytes: string) => void;
    /** Images picked from the photo library or camera. Omit to hide the image keys. */
    readonly onImageFiles?: (files: File[]) => void;
    readonly uploadingImage?: boolean;
}

// quick-keys bar for keys phone keyboards don't have — typing itself happens
// directly in the terminal; "prefix" sends herdr's default ctrl+a; ⌨ toggles
// the virtual keyboard on touch devices (taps navigate the TUI without it).
// ctrl/alt arm a one-shot modifier: the phone keyboard can't hold a modifier
// key while typing another, so the next character typed gets combined with it.
// img/cam upload an image and type its path in, for agents that read files.
export function Composer({
    disabled,
    keyboardEnabled,
    armedModifier,
    onToggleKeyboard,
    onToggleModifier,
    onSendBytes,
    onImageFiles,
    uploadingImage = false,
}: ComposerProps) {
    const [collapsed, setCollapsed] = useState(() => readQuickKeysCollapsed(localStorage, HAS_COARSE_POINTER));
    const galleryInputRef = useRef<HTMLInputElement>(null);
    const cameraInputRef = useRef<HTMLInputElement>(null);

    const toggleCollapsed = () => {
        setCollapsed((current) => {
            writeQuickKeysCollapsed(localStorage, !current);
            return !current;
        });
    };

    const onImageInputChange = (event: ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(event.target.files ?? []);
        // cleared so picking the same photo twice in a row still fires a change event
        event.target.value = '';
        if (files.length > 0) {
            onImageFiles?.(files);
        }
    };

    const onPaste = async () => {
        try {
            const text = await navigator.clipboard.readText();
            if (text) {
                onSendBytes(text);
            }
        } catch {
            // clipboard read denied or unavailable (plain http) — nothing to paste
        }
    };

    const renderKey = (key: QuickKey) => (
        <button
            key={key.label}
            type="button"
            className={key.danger ? 'key-btn key-danger' : 'key-btn'}
            title={key.title}
            aria-label={key.title}
            disabled={disabled}
            onClick={() => onSendBytes(key.bytes)}
        >
            {key.label}
        </button>
    );

    return (
        <footer className="composer">
            {/* a press moves focus to the button, blurring the terminal and closing the
                phone keyboard; cancelling mousedown keeps focus where it is. touchstart is
                left alone so the bar still scrolls, and click still fires */}
            <div
                className="quick-keys"
                role="toolbar"
                aria-label="quick keys"
                onMouseDown={(event) => event.preventDefault()}
            >
                <div className="key-group">
                    <button
                        type="button"
                        className="key-btn key-collapse"
                        aria-expanded={!collapsed}
                        aria-label={collapsed ? 'Show all quick keys' : 'Hide most quick keys'}
                        title={collapsed ? 'Show all quick keys' : 'Hide most quick keys'}
                        onClick={toggleCollapsed}
                    >
                        {collapsed ? '⌃' : '⌄'}
                    </button>
                    <button
                        type="button"
                        className={keyboardEnabled ? 'key-btn key-kbd key-active' : 'key-btn key-kbd'}
                        aria-pressed={keyboardEnabled}
                        aria-label={keyboardEnabled ? 'Hide the on-screen keyboard' : 'Show the on-screen keyboard'}
                        onClick={onToggleKeyboard}
                    >
                        ⌨
                    </button>
                    {MODIFIER_KEYS.map(({ modifier, label }) => (
                        <button
                            key={modifier}
                            type="button"
                            className={armedModifier === modifier ? 'key-btn key-active' : 'key-btn'}
                            aria-pressed={armedModifier === modifier}
                            aria-label={`Arm ${label} for the next key typed`}
                            title={`Arm ${label} for the next key typed`}
                            disabled={disabled}
                            onClick={() => onToggleModifier(modifier)}
                        >
                            {label}
                        </button>
                    ))}
                    {onImageFiles && (
                        <>
                            <input
                                ref={galleryInputRef}
                                type="file"
                                accept="image/*"
                                multiple
                                className="file-input"
                                onChange={onImageInputChange}
                                tabIndex={-1}
                            />
                            <input
                                ref={cameraInputRef}
                                type="file"
                                accept="image/*"
                                capture="environment"
                                className="file-input"
                                onChange={onImageInputChange}
                                tabIndex={-1}
                            />
                            <button
                                type="button"
                                className={uploadingImage ? 'key-btn key-busy' : 'key-btn'}
                                aria-label="Attach an image from photos"
                                title="Attach an image from photos — its path is typed into the pane"
                                disabled={disabled || uploadingImage}
                                onClick={() => galleryInputRef.current?.click()}
                            >
                                img
                            </button>
                            <button
                                type="button"
                                className={uploadingImage ? 'key-btn key-busy' : 'key-btn'}
                                aria-label="Attach an image from the camera"
                                title="Attach an image from the camera — its path is typed into the pane"
                                disabled={disabled || uploadingImage}
                                onClick={() => cameraInputRef.current?.click()}
                            >
                                cam
                            </button>
                        </>
                    )}
                    <button
                        type="button"
                        className="key-btn"
                        aria-label="Paste from clipboard"
                        title="Paste from clipboard"
                        disabled={disabled}
                        onClick={() => void onPaste()}
                    >
                        paste
                    </button>
                </div>
                {collapsed ? (
                    <div className="key-group">{COLLAPSED_KEYS.map(renderKey)}</div>
                ) : (
                    QUICK_KEY_GROUPS.map((group) => (
                        <div key={group[0].label} className="key-group">
                            {group.map(renderKey)}
                        </div>
                    ))
                )}
            </div>
        </footer>
    );
}
