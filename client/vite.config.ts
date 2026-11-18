import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
    // the legacy TUI client lives at /tui/. The server also serves it at / until the app client replaces it.
    base: '/tui/',
    plugins: [react()],
    build: {
        // the default target lowers xterm's `x ||= {}` into an undeclared `n={}`, which throws
        // in requestMode (DECRQM) and leaves the terminal black
        target: 'es2022',
        outDir: '../public',
        emptyOutDir: true,
    },
    server: {
        proxy: {
            '/tui/ws': {
                target: 'ws://127.0.0.1:7936',
                ws: true,
            },
        },
    },
});
