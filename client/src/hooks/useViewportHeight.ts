import { useEffect } from 'react';

/**
 * Keeps the `--app-height` CSS custom property in sync with the visual viewport
 * height. The visual viewport shrinks when the on-screen keyboard opens, so
 * sizing the app from it (instead of `vh`/`dvh`) keeps the whole UI inside the
 * area above the keyboard — including mobile "Request Desktop Site" mode, where
 * `vh`/`dvh` stay locked to the full page height.
 */
export function useViewportHeight(): void {
    useEffect(() => {
        const viewport = window.visualViewport;
        let frame = 0;

        const applyHeight = (): void => {
            frame = 0;
            const height = viewport?.height ?? window.innerHeight;
            document.documentElement.style.setProperty('--app-height', `${Math.round(height)}px`);
        };

        const scheduleUpdate = (): void => {
            if (frame !== 0) { return; }
            frame = window.requestAnimationFrame(applyHeight);
        };

        applyHeight();

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
