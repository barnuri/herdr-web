'use strict';

const os = require('node:os');
const pty = require('node-pty');

class PtySession {
    static DEFAULT_COLS = 100;

    static DEFAULT_ROWS = 30;

    static MIN_DIMENSION = 2;

    static MAX_DIMENSION = 500;

    constructor({ command, args = [], cwd = os.homedir(), env = null } = {}) {
        if (typeof command !== 'string' || command.length === 0) {
            throw new TypeError('command must be a non-empty string');
        }
        this.command = command;
        this.args = args;
        this.cwd = cwd;
        this.env = env;
        this.terminal = null;
    }

    // the TUI must not think it is nested inside a herdr pane, so the plugin's
    // HERDR_* runtime vars are stripped from the child environment
    static childEnv() {
        const env = { ...process.env };
        for (const key of Object.keys(env)) {
            if (key.startsWith('HERDR_')) {
                delete env[key];
            }
        }
        env.TERM = 'xterm-256color';
        env.COLORTERM = 'truecolor';
        return env;
    }

    static clampDimension(value, fallback) {
        const numeric = Number(value);
        if (!Number.isInteger(numeric)) {
            return fallback;
        }
        return Math.min(PtySession.MAX_DIMENSION, Math.max(PtySession.MIN_DIMENSION, numeric));
    }

    start({ cols, rows, onData, onExit }) {
        this.terminal = pty.spawn(this.command, this.args, {
            name: 'xterm-256color',
            cols: PtySession.clampDimension(cols, PtySession.DEFAULT_COLS),
            rows: PtySession.clampDimension(rows, PtySession.DEFAULT_ROWS),
            cwd: this.cwd,
            env: this.env ? { ...this.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' } : PtySession.childEnv(),
        });
        this.terminal.onData(onData);
        this.terminal.onExit(onExit);
    }

    write(data) {
        this.terminal?.write(data);
    }

    resize(cols, rows) {
        if (!this.terminal) {
            return;
        }
        this.terminal.resize(
            PtySession.clampDimension(cols, PtySession.DEFAULT_COLS),
            PtySession.clampDimension(rows, PtySession.DEFAULT_ROWS),
        );
    }

    kill() {
        try {
            this.terminal?.kill();
        } catch {}
        this.terminal = null;
    }
}

module.exports = { PtySession };
