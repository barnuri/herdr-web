'use strict';

const os = require('node:os');
const path = require('node:path');
const { execFile, spawn } = require('node:child_process');
const { PtySession } = require('./pty-session');

// hc is the herdr-core CLI. Its JSON-RPC API runs over `hc connect` (one JSON line per message).
// The live stream runs `hc attach <terminal>` in a PTY, so no framed protocol is needed.
const RPC_TIMEOUT_MS = 10_000;
const RPC_ID = 2;
const DETACH_KEY = '\x1c'; // ctrl+\, the key that detaches `hc attach`

// herdr-app ids and hc addresses are plain words; anything else never reaches a command line
const ID_PATTERN = /^[\w.-]{1,128}$/;
const TERMINAL_PATTERN = /^(?:[\w.-]{1,64}\/)?[\w.-]{1,128}$/; // t7, a name, or machine/t7

function hcBinPath() {
    return process.env.HC_BIN_PATH || path.join(os.homedir(), '.local', 'bin', 'hc');
}

function herdrAppBinPath() {
    return process.env.HERDR_APP_BIN_PATH || path.join(os.homedir(), '.local', 'bin', 'herdr-app');
}

function runFile(bin, args, timeoutMs) {
    return new Promise((resolve, reject) => {
        execFile(bin, args, { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
            if (error) {
                reject(new Error(String(stderr).trim() || error.message));
                return;
            }
            resolve(String(stdout));
        });
    });
}

class HcError extends Error {
    constructor(error) {
        super(error?.message || 'hc error');
        this.kind = error?.data?.kind || null;
    }
}

// One JSON-RPC call on its own `hc connect` process. Resolves with the call result,
// rejects with HcError when hc answers with an error, and with Error on a transport failure.
function rpc(method, params = {}, { bin = hcBinPath(), timeoutMs = RPC_TIMEOUT_MS } = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(bin, ['connect'], { stdio: ['pipe', 'pipe', 'pipe'] });
        let stdout = '';
        let stderr = '';
        const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs);
        child.stdin.on('error', () => {});
        child.stdout.on('data', (chunk) => {
            stdout += chunk;
        });
        child.stderr.on('data', (chunk) => {
            stderr += chunk;
        });
        child.on('error', (error) => {
            clearTimeout(timer);
            reject(error);
        });
        child.on('close', () => {
            clearTimeout(timer);
            for (const line of stdout.split('\n')) {
                let message;
                try {
                    message = JSON.parse(line);
                } catch {
                    continue;
                }
                if (message.id !== RPC_ID) {
                    continue;
                }
                if (message.error) {
                    reject(new HcError(message.error));
                    return;
                }
                resolve(message.result);
                return;
            }
            reject(new Error(stderr.trim() || `hc ${method} returned no result`));
        });
        const hello = { jsonrpc: '2.0', id: 1, method: 'hello', params: { generation: 1 } };
        const request = { jsonrpc: '2.0', id: RPC_ID, method, params };
        child.stdin.end(`${JSON.stringify(hello)}\n${JSON.stringify(request)}\n`);
    });
}

class HcBridge {
    constructor({ bin = hcBinPath(), appBin = herdrAppBinPath(), shell = process.env.SHELL || '/bin/zsh', timeoutMs = RPC_TIMEOUT_MS } = {}) {
        this.bin = bin;
        this.appBin = appBin;
        this.shell = shell;
        this.timeoutMs = timeoutMs;
        this.sessionBySocket = new Map();
    }

    onConnection(socket) {
        socket.on('message', (raw) => this.onMessage(socket, raw));
        socket.on('close', () => this.dropClient(socket));
    }

    async onMessage(socket, raw) {
        let message;
        try {
            message = JSON.parse(String(raw));
        } catch {
            this.send(socket, { type: 'error', message: 'invalid JSON' });
            return;
        }
        try {
            await this.handleMessage(socket, message);
        } catch (error) {
            this.send(socket, { type: 'error', message: error.message, kind: error.kind || null, request: message.type });
        }
    }

    // client -> server: list | world | read {terminal, lines} | attach {terminal, cols, rows}
    //                   | input {data} | resize {cols, rows} | detach | run {space, tab, cwd?} | kill {terminal}
    // server -> client: terminals | world {spaces, terminals} | read | attached | output {data}
    //                   | detached {code} | ran {terminal} | killed {terminal} | error
    async handleMessage(socket, message) {
        switch (message.type) {
            case 'list': {
                const result = await this.rpc('terminal.list', { all: message.all === true, labels: message.labels ?? {} });
                this.send(socket, { type: 'terminals', terminals: result.terminals, hidden_finished: result.hidden_finished });
                return;
            }
            case 'world': {
                const [list, spaces] = await Promise.all([
                    this.rpc('terminal.list', { all: false, labels: {} }),
                    this.appSpaces(),
                ]);
                this.send(socket, { type: 'world', spaces, terminals: list.terminals });
                return;
            }
            case 'run': {
                const terminal = await this.runShell(message);
                this.send(socket, { type: 'ran', terminal });
                return;
            }
            case 'kill': {
                const terminal = requireTerminal(message);
                await this.rpc('terminal.kill', { terminal });
                this.send(socket, { type: 'killed', terminal });
                return;
            }
            case 'read': {
                const result = await this.rpc('terminal.read', {
                    terminal: requireTerminal(message),
                    lines: Number(message.lines) || 0,
                });
                this.send(socket, { type: 'read', terminal: message.terminal, text: result.text, complete: result.complete });
                return;
            }
            case 'attach':
                this.attach(socket, message);
                return;
            case 'input':
                this.sessionBySocket.get(socket)?.write(String(message.data ?? ''));
                return;
            case 'resize':
                this.sessionBySocket.get(socket)?.resize(message.cols, message.rows);
                return;
            case 'detach':
                this.sessionBySocket.get(socket)?.write(DETACH_KEY);
                return;
            default:
                this.send(socket, { type: 'error', message: `unknown message type: ${message.type}` });
        }
    }

    rpc(method, params) {
        return rpc(method, params, { bin: this.bin, timeoutMs: this.timeoutMs });
    }

    // The app's spaces and tabs with their names. Null when herdr-app is not installed or not running,
    // so the client falls back to grouping by the herdr.space / herdr.tab labels alone.
    async appSpaces() {
        try {
            const parsed = JSON.parse(await runFile(this.appBin, ['ls'], this.timeoutMs));
            return Array.isArray(parsed?.spaces) ? parsed.spaces : null;
        } catch {
            return null;
        }
    }

    // A kept shell labelled with the space and tab, so the desktop app adopts it into that tab.
    async runShell(message) {
        const space = requireId(message.space, 'space');
        const tab = requireId(message.tab, 'tab');
        const args = ['run', '--bg', '--keep', '--no-parent', '--json', '--label', `herdr.space=${space}`, '--label', `herdr.tab=${tab}`];
        if (typeof message.cwd === 'string' && path.isAbsolute(message.cwd)) {
            args.push('--cwd', message.cwd);
        }
        args.push('--', this.shell);
        const result = JSON.parse(await runFile(this.bin, args, this.timeoutMs));
        return result.address;
    }

    attach(socket, message) {
        const terminal = requireTerminal(message);
        this.dropSession(socket);
        const session = new PtySession({ command: this.bin, args: ['attach', terminal] });
        this.sessionBySocket.set(socket, session);
        session.start({
            cols: message.cols,
            rows: message.rows,
            onData: (data) => this.send(socket, { type: 'output', data }),
            onExit: ({ exitCode }) => {
                if (this.sessionBySocket.get(socket) === session) {
                    this.sessionBySocket.delete(socket);
                }
                this.send(socket, { type: 'detached', code: exitCode });
            },
        });
        this.send(socket, { type: 'attached', terminal });
    }

    dropSession(socket) {
        const session = this.sessionBySocket.get(socket);
        if (session) {
            session.kill();
            this.sessionBySocket.delete(socket);
        }
    }

    dropClient(socket) {
        this.dropSession(socket);
    }

    send(socket, payload) {
        if (socket.readyState !== socket.OPEN) {
            return;
        }
        socket.send(JSON.stringify(payload));
    }
}

function requireTerminal(message) {
    if (typeof message.terminal !== 'string' || !TERMINAL_PATTERN.test(message.terminal)) {
        throw new TypeError('terminal must be a terminal address');
    }
    return message.terminal;
}

function requireId(value, name) {
    if (typeof value !== 'string' || !ID_PATTERN.test(value)) {
        throw new TypeError(`${name} must be an id`);
    }
    return value;
}

module.exports = { HcBridge, HcError, hcBinPath, herdrAppBinPath, rpc, DETACH_KEY };
