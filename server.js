#!/usr/bin/env node
'use strict';

const http = require('node:http');
const https = require('node:https');
const path = require('node:path');
const fs = require('node:fs');
const { WebSocketServer } = require('ws');
const { loadTlsOptions, activeCertificatePath } = require('./lib/tls');

const { loadConfig } = require('./lib/config');
const herdr = require('./lib/herdr');
const { PtySession } = require('./lib/pty-session');
const { ImageStore } = require('./lib/image-store');
const { PushService } = require('./lib/push-service');
const { StateWatcher } = require('./lib/state-watcher');

class HerdrWebServer {
    static PUBLIC_DIR = path.join(__dirname, 'public');

    static MIME_TYPES = {
        '.html': 'text/html; charset=utf-8',
        '.js': 'text/javascript; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.webmanifest': 'application/manifest+json',
        '.json': 'application/json',
        '.svg': 'image/svg+xml',
        '.png': 'image/png',
        '.ico': 'image/x-icon',
        '.woff2': 'font/woff2',
    };

    static MAX_PUSH_BODY_BYTES = 16 * 1024;

    // Coalesce PTY output into at most ~12 frames/sec. herdr's TUI emits one chunk per
    // repaint (~30/s while agents work); forwarding every chunk costs the phone one
    // parse+paint pass each, which is what makes the mobile view feel janky.
    static OUTPUT_FLUSH_MS = 80;

    // A burst this large is real output, not a spinner: send it now instead of waiting.
    static OUTPUT_MAX_PENDING_BYTES = 64 * 1024;

    static IMAGE_ROUTE = '/images';

    constructor(config, pushService = new PushService()) {
        this.config = config;
        this.watcher = new StateWatcher();
        this.push = pushService;
        this.images = new ImageStore();
        this.clients = new Set();
        this.ptyBySocket = new Map();
        this.lastTopology = null;
        this.topologyTimer = null;
    }

    start() {
        this.startListener(http.createServer((req, res) => this.handleHttp(req, res)), this.config.port, 'http');
        if (this.config.https) {
            this.startHttps();
        }
        this.topologyTimer = setInterval(() => this.pollTopology(), this.config.topologyPollMs);
        this.pollTopology();
    }

    startHttps() {
        const tls = loadTlsOptions(this.config);
        if (!tls) {
            process.stderr.write('herdr-web: https disabled — no cert configured and openssl is unavailable to self-sign one\n');
            return;
        }
        this.startListener(https.createServer(tls, (req, res) => this.handleHttp(req, res)), this.config.httpsPort, 'https');
    }

    startListener(server, port, scheme) {
        server.on('error', (error) => {
            if (error.code === 'EADDRINUSE') {
                process.stderr.write(`herdr-web: ${this.config.host}:${port} is already in use — is another instance running?\n`);
                process.exit(1);
            }
            throw error;
        });
        const wss = new WebSocketServer({
            server,
            path: '/ws',
            verifyClient: ({ origin, req }) => this.isAllowedOrigin(origin, req),
        });
        wss.on('connection', (socket) => this.onConnection(socket));
        server.listen(port, this.config.host, () => {
            process.stdout.write(`herdr-web listening on ${scheme}://${this.config.host}:${port}\n`);
        });
    }

    // browsers always send an Origin header on WebSocket upgrades; non-browser
    // clients (curl, native apps) may omit it and are allowed through
    isAllowedOrigin(origin, req) {
        if (!origin) {
            return true;
        }
        if (this.config.allowedOrigins.includes(origin)) {
            return true;
        }
        let originUrl;
        try {
            originUrl = new URL(origin);
        } catch {
            return false;
        }
        return originUrl.host === req.headers.host;
    }

    handleHttp(req, res) {
        let requestPath;
        try {
            requestPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
        } catch {
            res.writeHead(400);
            res.end('bad request');
            return;
        }
        if (requestPath.includes('\0')) {
            res.writeHead(400);
            res.end('bad request');
            return;
        }
        if (requestPath.startsWith('/push/')) {
            this.handlePushRoute(req, res, requestPath);
            return;
        }
        if (requestPath === HerdrWebServer.IMAGE_ROUTE && req.method === 'POST') {
            void this.handleImageUpload(req, res);
            return;
        }
        if (requestPath === '/meta') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ https: this.config.https, httpsPort: this.config.httpsPort }));
            return;
        }
        if (requestPath === '/cert') {
            const certPath = this.config.https ? activeCertificatePath(this.config) : null;
            if (!certPath) {
                res.writeHead(404);
                res.end('no certificate');
                return;
            }
            res.writeHead(200, {
                'Content-Type': 'application/x-x509-ca-cert',
                'Content-Disposition': 'attachment; filename="herdr-web.crt"',
            });
            res.end(fs.readFileSync(certPath));
            return;
        }
        this.serveStatic(requestPath, res);
    }

    handlePushRoute(req, res, requestPath) {
        const respond = (status, payload) => {
            res.writeHead(status, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(payload));
        };
        if (requestPath === '/push/public-key' && req.method === 'GET') {
            respond(200, { publicKey: this.push.publicKey });
            return;
        }
        if ((requestPath === '/push/subscribe' || requestPath === '/push/unsubscribe') && req.method === 'POST') {
            this.readJsonBody(req)
                .then((body) => {
                    if (requestPath === '/push/subscribe') {
                        const added = this.push.addSubscription(body);
                        if (added) {
                            // immediate end-to-end proof for the user that push works
                            void this.push.notifyOne(body, {
                                title: 'Notifications connected',
                                body: 'herdr-web will notify you when an agent finishes or gets stuck',
                                tag: 'herdr-web-connected',
                            });
                        }
                        respond(added ? 200 : 400, { ok: added });
                        return;
                    }
                    const removed = this.push.removeSubscription(body?.endpoint);
                    respond(200, { ok: removed });
                })
                .catch(() => respond(400, { ok: false }));
            return;
        }
        respond(404, { ok: false });
    }

    // Images are uploaded as a raw body with the type in the Content-Type header: one
    // field needs no multipart parser. The destination is never sent by the browser —
    // it is the focused pane's own working directory, read back from herdr.
    async handleImageUpload(req, res) {
        const respond = (status, payload) => {
            res.writeHead(status, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(payload));
        };

        let buffer;
        try {
            buffer = await this.readBinaryBody(req, ImageStore.MAX_BYTES);
        } catch (error) {
            const tooLarge = error.message === 'body too large';
            respond(tooLarge ? 413 : 400, {
                ok: false,
                message: tooLarge ? 'That image is too large.' : 'Could not read the upload.',
            });
            return;
        }

        const cwd = await this.focusedPaneCwd();
        const result = await this.images.save({ buffer, mimeType: req.headers['content-type'], cwd });
        if (!result.ok) {
            respond(result.status, { ok: false, message: result.message });
            return;
        }
        respond(200, { ok: true, path: result.path });
    }

    // foreground_cwd tracks where the pane's running program actually is, which is what
    // the user means by 'this project'; cwd is the shell's own and the fallback.
    async focusedPaneCwd() {
        try {
            const panes = await herdr.listPanes();
            const focused = panes.find((pane) => pane.focused) || panes[0];
            return focused?.foreground_cwd || focused?.cwd || null;
        } catch (error) {
            console.error(`herdr-web: could not resolve the focused pane's folder: ${error.message}`);
            return null;
        }
    }

    readBinaryBody(req, maxBytes) {
        return new Promise((resolve, reject) => {
            let size = 0;
            const chunks = [];
            req.on('data', (chunk) => {
                size += chunk.length;
                if (size > maxBytes) {
                    reject(new Error('body too large'));
                    req.destroy();
                    return;
                }
                chunks.push(chunk);
            });
            req.on('end', () => resolve(Buffer.concat(chunks)));
            req.on('error', reject);
        });
    }

    readJsonBody(req) {
        return new Promise((resolve, reject) => {
            let size = 0;
            const chunks = [];
            req.on('data', (chunk) => {
                size += chunk.length;
                if (size > HerdrWebServer.MAX_PUSH_BODY_BYTES) {
                    reject(new Error('body too large'));
                    req.destroy();
                    return;
                }
                chunks.push(chunk);
            });
            req.on('end', () => {
                try {
                    resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
                } catch (error) {
                    reject(error);
                }
            });
            req.on('error', reject);
        });
    }

    serveStatic(requestPath, res) {
        const { PUBLIC_DIR } = HerdrWebServer;
        const relative = requestPath === '/' ? 'index.html' : requestPath.replace(/^\/+/, '');
        const filePath = path.join(PUBLIC_DIR, relative);
        if (!filePath.startsWith(PUBLIC_DIR + path.sep) && filePath !== path.join(PUBLIC_DIR, 'index.html')) {
            res.writeHead(403);
            res.end('forbidden');
            return;
        }
        fs.readFile(filePath, (error, data) => {
            if (error) {
                res.writeHead(404);
                res.end('not found');
                return;
            }
            const mime = HerdrWebServer.MIME_TYPES[path.extname(filePath)] || 'application/octet-stream';
            res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-cache' });
            res.end(data);
        });
    }

    onConnection(socket) {
        this.clients.add(socket);
        socket.on('message', (raw) => this.onMessage(socket, raw));
        socket.on('close', () => this.dropClient(socket));
        if (this.lastTopology) {
            this.send(socket, this.lastTopology);
        }
    }

    dropClient(socket) {
        this.clients.delete(socket);
        const session = this.ptyBySocket.get(socket);
        if (session) {
            session.cancelPendingOutput?.();
            session.kill();
            this.ptyBySocket.delete(socket);
        }
    }

    onMessage(socket, raw) {
        let message;
        try {
            message = JSON.parse(String(raw));
        } catch {
            this.send(socket, { type: 'error', message: 'invalid JSON' });
            return;
        }
        try {
            this.handleMessage(socket, message);
        } catch (error) {
            this.send(socket, { type: 'error', message: error.message });
        }
    }

    handleMessage(socket, message) {
        const { type } = message;
        if (type === 'start' && !this.ptyBySocket.has(socket)) {
            this.startTerminal(socket, message);
            return;
        }
        if (type === 'input' && typeof message.data === 'string') {
            this.ptyBySocket.get(socket)?.write(message.data);
            return;
        }
        if (type === 'resize') {
            this.ptyBySocket.get(socket)?.resize(message.cols, message.rows);
            return;
        }
        if (type === 'refresh_topology') {
            this.pollTopology();
            return;
        }
        this.send(socket, { type: 'error', message: `unknown message type: ${String(type)}` });
    }

    // each browser client gets its own PTY attached to the herdr TUI, exactly
    // like a terminal window — herdr multiplexes concurrent attachments itself
    startTerminal(socket, { cols, rows }) {
        const session = new PtySession({
            command: process.env.HERDR_BIN_PATH || 'herdr',
            args: this.config.herdrArgs,
        });
        const pending = { data: '', timer: null };
        const flush = () => {
            if (pending.timer) {
                clearTimeout(pending.timer);
                pending.timer = null;
            }
            if (!pending.data) {
                return;
            }
            const data = pending.data;
            pending.data = '';
            this.send(socket, { type: 'output', data });
        };
        const queueOutput = (data) => {
            pending.data += data;
            if (pending.data.length >= HerdrWebServer.OUTPUT_MAX_PENDING_BYTES) {
                flush();
                return;
            }
            if (!pending.timer) {
                pending.timer = setTimeout(flush, HerdrWebServer.OUTPUT_FLUSH_MS);
            }
        };
        session.cancelPendingOutput = () => {
            if (pending.timer) {
                clearTimeout(pending.timer);
                pending.timer = null;
            }
            pending.data = '';
        };
        session.start({
            cols,
            rows,
            onData: queueOutput,
            onExit: ({ exitCode }) => {
                flush();
                this.send(socket, { type: 'exit', code: exitCode });
                this.ptyBySocket.delete(socket);
            },
        });
        this.ptyBySocket.set(socket, session);
    }

    async pollTopology() {
        let workspaces;
        let panes;
        try {
            [workspaces, panes] = await Promise.all([herdr.listWorkspaces(), herdr.listPanes()]);
        } catch (error) {
            this.broadcast({ type: 'error', message: `herdr unreachable: ${error.message}` });
            return;
        }
        this.lastTopology = { type: 'topology', workspaces, panes };
        this.broadcast(this.lastTopology);
        const events = this.watcher.update(panes);
        for (const event of events) {
            this.broadcast({ type: 'agent_event', event });
            if (event.from !== null) {
                void this.push.notifyAll(HerdrWebServer.pushPayloadFor(event), { routine: !event.notifyWorthy });
            }
        }
    }

    static pushPayloadFor(event) {
        const agent = event.agent || 'agent';
        const where = event.title || event.paneId;
        if (event.to === 'blocked') {
            return { title: `${agent} needs attention`, body: where, tag: event.paneId };
        }
        if (event.from === 'working') {
            return { title: `${agent} finished (${event.to})`, body: where, tag: event.paneId };
        }
        return { title: `${agent}: ${event.from} → ${event.to}`, body: where, tag: event.paneId };
    }

    broadcast(payload) {
        for (const socket of this.clients) {
            this.send(socket, payload);
        }
    }

    send(socket, payload) {
        if (socket.readyState !== socket.OPEN) {
            return;
        }
        socket.send(JSON.stringify(payload));
    }
}

if (require.main === module) {
    new HerdrWebServer(loadConfig()).start();
}

module.exports = { HerdrWebServer };
