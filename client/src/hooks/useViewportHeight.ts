import { useEffect } from 'react';
import { nextViewportLayout } from '../lib/viewport-offset';

/**
 * Keeps `--app-height` at the visible height (above the on-screen keyboard when it is open) and
 * `--viewport-top` at how far the browser panned the visual viewport. Sizing from the visual
 * viewport (instead of `vh`/`dvh`) also covers mobile "Request Desktop Site" mode, where
 * `vh`/`dvh` stay locked to the full page height.
 */
export function useViewportHeight(): void {
    useEffect(() => {
        const viewport = window.visualViewport;
        const rootStyle = document.documentElement.style;
        let frame = 0;

        const applyLayout = (): void => {
            frame = 0;
            const layout = nextViewportLayout({
                height: Math.round(viewport?.height ?? window.innerHeight),
                offsetTop: Math.round(viewport?.offsetTop ?? 0),
            });
            rootStyle.setProperty('--app-height', `${layout.height}px`);
            rootStyle.setProperty('--viewport-top', `${layout.top}px`);
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
