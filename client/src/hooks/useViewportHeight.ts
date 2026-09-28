import { useEffect } from 'react';
import { nextViewportLayout, type ViewportLayout } from '../lib/viewport-offset';

/**
 * Keeps `--app-height` at the keyboard-closed height and `--keyboard-offset` at how far the
 * app must slide up to keep its bottom above the on-screen keyboard. Sizing from the visual
 * viewport (instead of `vh`/`dvh`) also covers mobile "Request Desktop Site" mode, where
 * `vh`/`dvh` stay locked to the full page height.
 */
export function useViewportHeight(): void {
    useEffect(() => {
        const viewport = window.visualViewport;
        const rootStyle = document.documentElement.style;
        let layout: ViewportLayout | null = null;
        let frame = 0;

        const applyLayout = (): void => {
            frame = 0;
            layout = nextViewportLayout(
                {
                    width: Math.round(viewport?.width ?? window.innerWidth),
                    height: Math.round(viewport?.height ?? window.innerHeight),
                    offsetTop: Math.round(viewport?.offsetTop ?? 0),
                },
                layout,
            );
            rootStyle.setProperty('--app-height', `${layout.fullHeight}px`);
            rootStyle.setProperty('--keyboard-offset', `${layout.keyboardOffset}px`);
        };

        const scheduleUpdate = (): void => {
            if (frame !== 0) { return; }
            frame = window.requestAnimationFrame(applyLayout);
        };

        applyLayout();

        viewport?.addEventListener('resize', scheduleUpdate);
        viewport?.addEventListener('scroll', scheduleUpdate);
        window.addEventListener('resize', scheduleUpdate);
        window.addEventListener('orientationchange', scheduleUpdate);

        return () => {
            if (frame !== 0) { window.cancelAnimationFrame(frame); }
            viewport?.removeEventListener('resize', scheduleUpdate);
            viewport?.removeEventListener('scroll', scheduleUpdate);
            window.removeEventListener('resize', scheduleUpdate);
            window.removeEventListener('orientationchange', scheduleUpdate);
        };
    }, []);
}
