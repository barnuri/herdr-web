import { useEffect, useRef } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import '@xterm/xterm/css/xterm.css';
import type { ClientMessage } from '../types';
import type { TerminalMessage } from '../hooks/useHerdrSocket';
import { applyModifier, type ArmedModifier } from '../lib/modifier-keys';
import { ApcSplitter } from '../lib/kitty/apc-splitter';
import { parseKittyControl } from '../lib/kitty/control';
import { KittyImageStore } from '../lib/kitty/image-store';
import { KittyOverlayRenderer } from '../lib/kitty/overlay-renderer';
import { toVisibleFrames } from '../lib/kitty/visible-frames';
import type { KittyBitmap } from '../lib/kitty/types';
import { TouchGestureRecognizer, type TouchPoint } from '../lib/touch/gesture-recognizer';
import { FLING_MAX_FRAME_MS, planScroll, ScrollFling } from '../lib/touch/scroll-planner';
import { imageFilesFromDataTransfer } from '../lib/terminal-image';

const MOBILE_MAX_WIDTH_PX = 768;
const MOBILE_FONT_SIZE = 12;
const DESKTOP_FONT_SIZE = 14;
const RESIZE_DEBOUNCE_MS = 150;
const RIGHT_MOUSE_BUTTON = 2;
const RIGHT_MOUSE_BUTTONS_MASK = 2;
const LONG_PRESS_HAPTIC_MS = 15;

// herdr transmits terminal-browser frames as raw RGBA (kitty graphics f=32)
async function decodeRgbaFrame(
    pixels: Uint8ClampedArray<ArrayBuffer>,
    width: number,
    height: number,
): Promise<KittyBitmap> {
    const bitmap = await createImageBitmap(new ImageData(pixels, width, height));
    return { width, height, source: bitmap, close: () => bitmap.close() };
}

// nerd-font families first so herdr's TUI glyphs render; the self-hosted
// Symbols Nerd Font Mono (style.css @font-face) is the guaranteed fallback
const TERMINAL_FONT_FAMILY =
    '"JetBrainsMono Nerd Font Mono", "JetBrainsMono Nerd Font", "MesloLGS NF", ' +
    '"FiraCode Nerd Font", "Hack Nerd Font Mono", "Symbols Nerd Font Mono", ' +
    'Menlo, Monaco, "Courier New", monospace';

const TERMINAL_THEME = {
    background: '#050607',
    foreground: '#e8eef2',
    cursor: '#7cb8ff',
    selectionBackground: '#264f78',
};

interface XTermViewProps {
    readonly connected: boolean;
    readonly keyboardEnabled: boolean;
    readonly armedModifier: ArmedModifier | null;
    readonly onModifierApplied: () => void;
    readonly send: (message: ClientMessage) => void;
    readonly subscribeTerminal: (handler: (message: TerminalMessage) => void) => () => void;
    /** Images pasted into, or dropped onto, the terminal. Omit to ignore both. */
    readonly onImageFiles?: (files: File[]) => void;
}

export function XTermView({
    connected,
    keyboardEnabled,
    armedModifier,
    onModifierApplied,
    send,
    subscribeTerminal,
    onImageFiles,
}: XTermViewProps) {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const onImageFilesRef = useRef(onImageFiles);
    onImageFilesRef.current = onImageFiles;
    const xtermRef = useRef<XTerm | null>(null);
    const fitAddonRef = useRef<FitAddon | null>(null);
    const startedRef = useRef(false);
    const armedModifierRef = useRef(armedModifier);
    const onModifierAppliedRef = useRef(onModifierApplied);
    const graphicsResetRef = useRef<(() => void) | null>(null);

    useEffect(() => {
        armedModifierRef.current = armedModifier;
    }, [armedModifier]);
    useEffect(() => {
        onModifierAppliedRef.current = onModifierApplied;
    }, [onModifierApplied]);

    useEffect(() => {
        const container = containerRef.current;
        if (!container) {
            return;
        }
        const isMobile = window.innerWidth <= MOBILE_MAX_WIDTH_PX;
        const xterm = new XTerm({
            cursorBlink: true,
            fontSize: isMobile ? MOBILE_FONT_SIZE : DESKTOP_FONT_SIZE,
            fontFamily: TERMINAL_FONT_FAMILY,
            theme: TERMINAL_THEME,
            scrollback: 5000,
            allowProposedApi: true,
            // herdr asks for the cell size (CSI 16 t) to size kitty graphics frames;
            // without an answer it falls back to 8x16 and the frames arrive upscaled
            windowOptions: { getCellSizePixels: true },
        });
        const fitAddon = new FitAddon();
        xterm.loadAddon(fitAddon);
        xterm.open(container);
        fitAddon.fit();

        // WebGL renderer: xterm's default DOM renderer repaints cell-by-cell, which is the
        // biggest single cost on a phone. Loaded after open() (the addon needs the canvas);
        // silently keeps the default renderer where WebGL is unavailable or lost.
        try {
            const webglAddon = new WebglAddon();
            webglAddon.onContextLoss(() => webglAddon.dispose());
            xterm.loadAddon(webglAddon);
        } catch {
            /* no WebGL: DOM renderer stays */
        }

        xtermRef.current = xterm;
        fitAddonRef.current = fitAddon;

        // xterm cannot parse APC (its docs list APC/PM/SOS as unsupported), so kitty graphics
        // sequences are lifted out of the stream here and drawn on an overlay canvas instead
        const splitter = new ApcSplitter();
        const screen = xterm.element?.querySelector<HTMLElement>('.xterm-screen') ?? null;
        const renderer = screen === null ? null : new KittyOverlayRenderer(screen);
        let redrawHandle: number | null = null;

        const drawGraphics = () => {
            redrawHandle = null;
            if (renderer === null || screen === null) {
                return;
            }
            const buffer = xterm.buffer.active;
            const frames = toVisibleFrames(imageStore.visiblePlacements, buffer.viewportY, xterm.rows);
            renderer.render(frames, (imageId) => imageStore.bitmapFor(imageId), {
                width: screen.clientWidth / xterm.cols,
                height: screen.clientHeight / xterm.rows,
            });
        };
        const scheduleRedraw = () => {
            if (redrawHandle === null) {
                redrawHandle = window.requestAnimationFrame(drawGraphics);
            }
        };
        const imageStore = new KittyImageStore(decodeRgbaFrame, scheduleRedraw);
        graphicsResetRef.current = () => {
            splitter.reset();
            imageStore.clear();
        };

        // a placement anchors at the cursor, so it must be applied at its exact position in the
        // stream — xterm runs write callbacks in order, which makes an empty write a safe marker
        const writeWithGraphics = (data: string) => {
            for (const part of splitter.feed(data)) {
                if (part.kind === 'text') {
                    xterm.write(part.text);
                    continue;
                }
                const control = parseKittyControl(part.control);
                const { payload } = part;
                xterm.write('', () => {
                    const buffer = xterm.buffer.active;
                    imageStore.handleSequence(control, payload, {
                        col: buffer.cursorX,
                        absRow: buffer.baseY + buffer.cursorY,
                    });
                });
            }
        };

        const renderDisposable = xterm.onRender(scheduleRedraw);
        const scrollDisposable = xterm.onScroll(scheduleRedraw);
        const resizeDisposable = xterm.onResize(scheduleRedraw);

        const inputDisposable = xterm.onData((data) => {
            const modifier = armedModifierRef.current;
            if (modifier && data.length === 1) {
                onModifierAppliedRef.current();
                send({ type: 'input', data: applyModifier(modifier, data) });
                return;
            }
            send({ type: 'input', data });
        });

        const unsubscribe = subscribeTerminal((message) => {
            if (message.type === 'output') {
                writeWithGraphics(message.data);
                return;
            }
            xterm.write(`\r\n\x1b[2m[herdr exited with code ${message.code} — reconnecting will restart it]\x1b[0m\r\n`);
            startedRef.current = false;
        });

        let resizeTimer: ReturnType<typeof setTimeout> | null = null;
        const observer = new ResizeObserver(() => {
            if (resizeTimer !== null) {
                clearTimeout(resizeTimer);
            }
            resizeTimer = setTimeout(() => {
                fitAddon.fit();
                send({ type: 'resize', cols: xterm.cols, rows: xterm.rows });
            }, RESIZE_DEBOUNCE_MS);
        });
        observer.observe(container);

        return () => {
            observer.disconnect();
            if (resizeTimer !== null) {
                clearTimeout(resizeTimer);
            }
            if (redrawHandle !== null) {
                window.cancelAnimationFrame(redrawHandle);
            }
            unsubscribe();
            inputDisposable.dispose();
            renderDisposable.dispose();
            scrollDisposable.dispose();
            resizeDisposable.dispose();
            graphicsResetRef.current = null;
            imageStore.clear();
            renderer?.dispose();
            xterm.dispose();
            xtermRef.current = null;
            fitAddonRef.current = null;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // touch devices: taps should navigate the TUI (mouse events) without popping
    // the virtual keyboard — inputMode 'none' suppresses it until the ⌨ toggle
    useEffect(() => {
        const textarea = xtermRef.current?.textarea;
        if (!textarea) {
            return;
        }
        textarea.inputMode = keyboardEnabled ? 'text' : 'none';
        if (keyboardEnabled) {
            xtermRef.current?.focus();
        }
    }, [keyboardEnabled]);

    // every (re)connect gets a fresh server-side PTY, so restart the TUI stream
    useEffect(() => {
        const xterm = xtermRef.current;
        if (!connected || !xterm) {
            return;
        }
        if (startedRef.current) {
            xterm.reset();
            graphicsResetRef.current?.();
        }
        fitAddonRef.current?.fit();
        send({ type: 'start', cols: xterm.cols, rows: xterm.rows });
        startedRef.current = true;
        xterm.focus();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [connected]);

    // touch devices fire no native "wheel" event, so drag gestures never reach xterm's own
    // wheel handler — the one that scrolls scrollback, or (in the TUI's alt-screen buffer with
    // mouse tracking on) sends SGR mouse-scroll codes / arrow keys. Re-synthesize the mouse
    // events from touch instead of duplicating xterm's own scroll/tracking logic. The
    // coordinates matter: herdr reports mouse position per cell, so an event without
    // clientX/clientY lands on cell (1, 1) and scrolls whatever sits in the corner.
    useEffect(() => {
        const container = containerRef.current;
        if (!container) {
            return;
        }

        const dispatchToTerminal = (event: MouseEvent) => {
            xtermRef.current?.element?.dispatchEvent(event);
        };
        // Convert drag pixels to whole lines before dispatching: xterm's pixel mode scales
        // moves under 50px to 30% and then rounds, so almost every small touch move is lost
        // (the root cause of scrolling that lags the finger). Line mode has no scaling.
        // Scrollback scrolls locally via scrollLines (no latency); a TUI (alternate screen +
        // mouse tracking) gets line wheel events, exactly one SGR scroll notch per event.
        let scrollRemainder = 0;
        // returns whether this scroll actually moved the viewport; the alternate screen (TUI mouse tracking) has no local bounds, so it is always true
        const applyScrollLines = (lines: number, point: TouchPoint, xterm: XTerm): boolean => {
            if (xterm.buffer.active.type === 'normal') {
                const before = xterm.buffer.active.viewportY;
                xterm.scrollLines(lines);
                return xterm.buffer.active.viewportY !== before;
            }
            const step = lines > 0 ? 1 : -1;
            for (let i = 0; i < Math.abs(lines); i++) {
                dispatchToTerminal(
                    new WheelEvent('wheel', {
                        deltaY: step,
                        deltaMode: WheelEvent.DOM_DELTA_LINE,
                        clientX: point.x,
                        clientY: point.y,
                        bubbles: true,
                        cancelable: true,
                    }),
                );
            }
            return true;
        };

        const cellHeightOf = (xterm: XTerm): number => {
            const screen = xterm.element?.querySelector<HTMLElement>('.xterm-screen') ?? null;
            return screen && xterm.rows > 0 ? screen.clientHeight / xterm.rows : 16;
        };

        const scrollByPixels = (deltaPx: number, point: TouchPoint, xterm: XTerm): boolean => {
            const plan = planScroll(deltaPx, cellHeightOf(xterm), scrollRemainder);
            scrollRemainder = plan.remainder;
            return plan.lines === 0 || applyScrollLines(plan.lines, point, xterm);
        };

        // Inertia: after release, keep scrolling frame by frame while the release velocity decays.
        // rAF instead of a timer: the frame interval is the decay time step, and rAF pauses
        // while the page is hidden, so it does not jump far when the page comes back.
        let fling: ScrollFling | null = null;
        let flingHandle: number | null = null;
        let flingPoint: TouchPoint = { x: 0, y: 0 };
        let lastFrameMs = 0;

        const stopFling = () => {
            if (flingHandle !== null) {
                window.cancelAnimationFrame(flingHandle);
                flingHandle = null;
            }
            fling = null;
        };

        const stepFling = (now: number) => {
            flingHandle = null;
            const active = fling;
            const xterm = xtermRef.current;
            if (active === null || xterm === null) {
                fling = null;
                return;
            }
            // clamp the per-frame step: after backgrounding or dropped frames, do not count the whole pause as decay time, or it jumps a long way
            const deltaPx = active.step(Math.min(now - lastFrameMs, FLING_MAX_FRAME_MS));
            lastFrameMs = now;
            if (!scrollByPixels(deltaPx, flingPoint, xterm)) {
                // hit a bound: drop the remainder and stop now so velocity does not build up and jitter at the edge
                scrollRemainder = 0;
                fling = null;
                return;
            }
            if (!active.active) {
                fling = null;
                return;
            }
            flingHandle = window.requestAnimationFrame(stepFling);
        };

        const startFling = (velocity: number, point: TouchPoint) => {
            stopFling();
            const planner = new ScrollFling(velocity);
            if (!planner.active) {
                return;
            }
            fling = planner;
            flingPoint = point;
            lastFrameMs = performance.now();
            flingHandle = window.requestAnimationFrame(stepFling);
        };

        const recognizer = new TouchGestureRecognizer({
            onScroll: (deltaY, point) => {
                const xterm = xtermRef.current;
                if (!xterm) {
                    return;
                }
                scrollByPixels(deltaY, point, xterm);
            },
            // holding a finger is the touch equivalent of a right click, which is how herdr's
            // own right-click handling becomes reachable from a phone
            onLongPress: (point) => {
                // the hold threshold is invisible, so confirm it the way a native long press does
                navigator.vibrate?.(LONG_PRESS_HAPTIC_MS);
                for (const type of ['mousedown', 'mouseup'] as const) {
                    dispatchToTerminal(
                        new MouseEvent(type, {
                            button: RIGHT_MOUSE_BUTTON,
                            buttons: type === 'mousedown' ? RIGHT_MOUSE_BUTTONS_MASK : 0,
                            clientX: point.x,
                            clientY: point.y,
                            bubbles: true,
                            cancelable: true,
                        }),
                    );
                }
            },
        });

        const pointOf = (event: TouchEvent): TouchPoint => ({
            x: event.touches[0].clientX,
            y: event.touches[0].clientY,
        });
        let lastPoint: TouchPoint = { x: 0, y: 0 };
        const onTouchStart = (event: TouchEvent) => {
            if (event.touches.length === 1) {
                // a finger touching down again takes over scrolling: running inertia stops immediately
                stopFling();
                scrollRemainder = 0;
                lastPoint = pointOf(event);
                recognizer.start(lastPoint);
            }
        };
        const onTouchMove = (event: TouchEvent) => {
            if (event.touches.length !== 1) {
                return;
            }
            lastPoint = pointOf(event);
            if (recognizer.move(lastPoint)) {
                event.preventDefault();
            }
        };
        // after a hold the browser still emits its compatibility mouse events, which would land
        // a left click on top of the right click we just sent; preventing the touchend default
        // is what suppresses them
        const finishGesture = (event: TouchEvent, allowFling: boolean) => {
            // didLongPress is cleared by end(), so read it before ending the gesture
            const didLongPress = recognizer.didLongPress;
            if (didLongPress) {
                event.preventDefault();
            }
            const velocity = recognizer.end();
            if (!allowFling || didLongPress) {
                return;
            }
            // only continue with inertia above the velocity threshold: taps, long presses and slow drags all give 0, so gestures do not conflict
            startFling(velocity, lastPoint);
        };
        const onTouchEnd = (event: TouchEvent) => {
            finishGesture(event, true);
        };
        // touchcancel means the system took the gesture (incoming call, notification shade); continuing inertia would scroll on its own, so stop
        const onTouchCancel = (event: TouchEvent) => {
            finishGesture(event, false);
        };
        // the native menu would cover the terminal on every right click — on desktop it hides
        // herdr's own right-click handling, and on touch it duplicates the long press we just
        // turned into a right click. The mousedown/mouseup still reach xterm either way.
        const onContextMenu = (event: MouseEvent) => {
            event.preventDefault();
        };

        container.addEventListener('touchstart', onTouchStart, { passive: true });
        container.addEventListener('touchmove', onTouchMove, { passive: false });
        container.addEventListener('touchend', onTouchEnd, { passive: false });
        container.addEventListener('touchcancel', onTouchCancel, { passive: false });
        container.addEventListener('contextmenu', onContextMenu);
        return () => {
            container.removeEventListener('touchstart', onTouchStart);
            container.removeEventListener('touchmove', onTouchMove);
            container.removeEventListener('touchend', onTouchEnd);
            container.removeEventListener('touchcancel', onTouchCancel);
            container.removeEventListener('contextmenu', onContextMenu);
            stopFling();
            recognizer.end();
        };
    }, []);

    // Image paste and drop. A paste that also carries text is left alone — text is what
    // the user meant, and xterm already handles it.
    useEffect(() => {
        const container = containerRef.current;
        if (!container) {
            return;
        }

        const emit = (files: File[]): boolean => {
            if (files.length === 0) {
                return false;
            }
            onImageFilesRef.current?.(files);
            return true;
        };

        const onPaste = (event: ClipboardEvent) => {
            if (event.clipboardData?.getData('text/plain')) {
                return;
            }
            if (emit(imageFilesFromDataTransfer(event.clipboardData))) {
                event.preventDefault();
                event.stopPropagation();
            }
        };

        const draggingFiles = (event: DragEvent): boolean =>
            Array.from(event.dataTransfer?.items ?? []).some((item) => item.kind === 'file');

        const onDragOver = (event: DragEvent) => {
            if (!draggingFiles(event)) {
                return;
            }
            event.preventDefault();
            if (event.dataTransfer) {
                event.dataTransfer.dropEffect = 'copy';
            }
            container.classList.add('drop-target');
        };

        const onDragLeave = (event: DragEvent) => {
            if (event.relatedTarget instanceof Node && container.contains(event.relatedTarget)) {
                return;
            }
            container.classList.remove('drop-target');
        };

        const onDrop = (event: DragEvent) => {
            container.classList.remove('drop-target');
            if (!draggingFiles(event)) {
                return;
            }
            event.preventDefault();
            emit(imageFilesFromDataTransfer(event.dataTransfer));
        };

        container.addEventListener('paste', onPaste);
        container.addEventListener('dragover', onDragOver);
        container.addEventListener('dragleave', onDragLeave);
        container.addEventListener('drop', onDrop);
        return () => {
            container.removeEventListener('paste', onPaste);
            container.removeEventListener('dragover', onDragOver);
            container.removeEventListener('dragleave', onDragLeave);
            container.removeEventListener('drop', onDrop);
        };
    }, []);

    return <main ref={containerRef} className="xterm-wrap" />;
}
