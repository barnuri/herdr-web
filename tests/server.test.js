'use strict';

const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { Readable } = require('stream');

const { HerdrWebServer } = require('../server');

function makeConfig(overrides = {}) {
  return {
    host: '127.0.0.1',
    port: 0,
    topologyPollMs: 2000,
    allowedOrigins: [],
    ...overrides,
  };
}

function makePushStub() {
  return {
    publicKey: 'test-public-key',
    added: [],
    removed: [],
    notified: [],
    addSubscription(sub) {
      if (!sub || typeof sub.endpoint !== 'string') { return false; }
      this.added.push(sub);
      return true;
    },
    removeSubscription(endpoint) {
      this.removed.push(endpoint);
      return true;
    },
    async notifyAll(payload, options = {}) {
      this.notified.push({ ...payload, routine: options.routine === true });
    },
    async notifyOne(subscription, payload) {
      this.notified.push({ ...payload, to: subscription.endpoint });
      return true;
    },
  };
}

function makeServer(overrides = {}) {
  return new HerdrWebServer(makeConfig(overrides), makePushStub());
}

function makeJsonReq(method, url, body) {
  const req = Readable.from([Buffer.from(JSON.stringify(body))]);
  req.url = url;
  req.method = method;
  req.headers = {};
  req.destroy = () => {};
  return req;
}

function makeSocket() {
  const sent = [];
  return {
    readyState: 1,
    OPEN: 1,
    send: (raw) => sent.push(JSON.parse(raw)),
    sent,
  };
}

// fake req/res pair for serveStatic; res.finished resolves once end() is
// called so the async fs.readFile path can be awaited
function makeRes() {
  const res = { statusCode: null, headers: null, body: null };
  res.finished = new Promise((resolve) => {
    res.writeHead = (status, headers) => {
      res.statusCode = status;
      res.headers = headers || null;
    };
    res.end = (data) => {
      res.body = data;
      resolve();
    };
  });
  return res;
}

describe('HerdrWebServer', () => {
  describe('isAllowedOrigin', () => {
    const req = { headers: { host: '127.0.0.1:7936' } };

    test('missing origin is allowed (non-browser clients)', () => {
      const server = makeServer();
      assert.equal(server.isAllowedOrigin(undefined, req), true);
      assert.equal(server.isAllowedOrigin('', req), true);
    });

    test('origin whose host matches the request host is allowed', () => {
      const server = makeServer();
      assert.equal(server.isAllowedOrigin('http://127.0.0.1:7936', req), true);
    });

    test('origin whose host does not match the request host is rejected', () => {
      const server = makeServer();
      assert.equal(server.isAllowedOrigin('http://evil.example.com', req), false);
      assert.equal(server.isAllowedOrigin('http://127.0.0.1:9999', req), false);
    });

    test('malformed origin string is rejected, not thrown', () => {
      const server = makeServer();
      assert.equal(server.isAllowedOrigin('not a url', req), false);
    });

    test('explicitly configured allowedOrigins entry is accepted despite host mismatch', () => {
      const server = makeServer({ allowedOrigins: ['https://phone.example.com'] });
      assert.equal(server.isAllowedOrigin('https://phone.example.com', req), true);
    });
  });

  describe('serveStatic', () => {
    let server;

    beforeEach(() => {
      server = makeServer();
    });

    test('malformed percent-encoding returns 400 instead of throwing', async () => {
      const res = makeRes();
      server.handleHttp({ url: '/%zz', headers: {}, method: "GET" }, res);
      await res.finished;
      assert.equal(res.statusCode, 400);
    });

    test('null byte in the path returns 400', async () => {
      const res = makeRes();
      server.handleHttp({ url: '/%00', headers: {}, method: "GET" }, res);
      await res.finished;
      assert.equal(res.statusCode, 400);
    });

    test('plain ../ traversal never serves files outside public/', async () => {
      const res = makeRes();
      server.handleHttp({ url: '/../server.js', headers: {}, method: "GET" }, res);
      await res.finished;
      assert.ok([403, 404].includes(res.statusCode), `expected 403/404, got ${res.statusCode}`);
    });

    test('encoded-slash ../ traversal is rejected with 403', async () => {
      const res = makeRes();
      server.handleHttp({ url: '/..%2Fserver.js', headers: {}, method: "GET" }, res);
      await res.finished;
      assert.equal(res.statusCode, 403);
    });

    test('/index.html is served from public/ with the html mime type', async () => {
      const res = makeRes();
      server.handleHttp({ url: '/index.html', headers: {}, method: "GET" }, res);
      await res.finished;
      assert.equal(res.statusCode, 200);
      assert.equal(res.headers['Content-Type'], 'text/html; charset=utf-8');
      assert.ok(res.body.length > 0);
    });

    test('/meta reports the clientBidi setting', async () => {
      const res = makeRes();
      makeServer({ clientBidi: false }).handleHttp({ url: '/meta', headers: {}, method: 'GET' }, res);
      await res.finished;
      assert.equal(res.statusCode, 200);
      assert.equal(JSON.parse(res.body).clientBidi, false);
    });

    test('/ maps to index.html', async () => {
      const res = makeRes();
      server.handleHttp({ url: '/', headers: {}, method: "GET" }, res);
      await res.finished;
      assert.equal(res.statusCode, 200);
      assert.equal(res.headers['Content-Type'], 'text/html; charset=utf-8');
    });
  });

  describe('handleMessage', () => {
    let server;
    let savedBinPath;
    let tempDir;

    beforeEach(() => {
      server = makeServer();
      savedBinPath = process.env.HERDR_BIN_PATH;
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'herdr-web-server-test-'));
    });

    afterEach(() => {
      if (savedBinPath === undefined) {
        delete process.env.HERDR_BIN_PATH;
      } else {
        process.env.HERDR_BIN_PATH = savedBinPath;
      }
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    test('unknown message type replies with an error', async () => {
      const socket = makeSocket();
      server.handleMessage(socket, { type: 'bogus' });
      assert.deepEqual(socket.sent, [{ type: 'error', message: 'unknown message type: bogus' }]);
    });

    test('input with a non-string payload falls through to the unknown-type error', () => {
      const socket = makeSocket();
      server.handleMessage(socket, { type: 'input', data: 42 });
      assert.deepEqual(socket.sent, [{ type: 'error', message: 'unknown message type: input' }]);
    });

    test('input and resize without a started terminal are silent no-ops', () => {
      const socket = makeSocket();
      server.handleMessage(socket, { type: 'input', data: 'x' });
      server.handleMessage(socket, { type: 'resize', cols: 80, rows: 24 });
      assert.deepEqual(socket.sent, []);
    });

    test('start spawns one pty per socket and ignores a duplicate start', async () => {
      // the stub must stay alive like a TUI would, or onExit races the assertions
      const ttyStub = path.join(tempDir, 'tty-stub');
      fs.writeFileSync(ttyStub, '#!/bin/sh\ncat\n', { mode: 0o755 });
      process.env.HERDR_BIN_PATH = ttyStub;
      const socket = makeSocket();
      server.handleMessage(socket, { type: 'start', cols: 80, rows: 24 });
      assert.equal(server.ptyBySocket.size, 1);
      const first = server.ptyBySocket.get(socket);
      server.handleMessage(socket, { type: 'start', cols: 80, rows: 24 });
      assert.equal(server.ptyBySocket.get(socket), first);
      server.dropClient(socket);
      assert.equal(server.ptyBySocket.size, 0);
    });

    test('terminal output is streamed back to the owning socket', async () => {
      const ttyStub = path.join(tempDir, 'tty-stub');
      fs.writeFileSync(ttyStub, '#!/bin/sh\nprintf hello-from-pty\ncat\n', { mode: 0o755 });
      process.env.HERDR_BIN_PATH = ttyStub;
      const socket = makeSocket();
      server.handleMessage(socket, { type: 'start', cols: 80, rows: 24 });
      const deadline = Date.now() + 3000;
      let output = '';
      while (Date.now() < deadline && !output.includes('hello-from-pty')) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        output = socket.sent.filter((m) => m.type === 'output').map((m) => m.data).join('');
      }
      assert.ok(output.includes('hello-from-pty'), `expected pty output, got: ${JSON.stringify(socket.sent)}`);
      server.dropClient(socket);
    });
  });

  describe('push routes', () => {
    test('GET /push/public-key returns the VAPID public key', async () => {
      const server = makeServer();
      const res = makeRes();
      server.handleHttp({ url: '/push/public-key', method: 'GET', headers: {} }, res);
      await res.finished;
      assert.equal(res.statusCode, 200);
      assert.deepEqual(JSON.parse(res.body), { publicKey: 'test-public-key' });
    });

    test('POST /push/subscribe stores a valid subscription', async () => {
      const server = makeServer();
      const res = makeRes();
      server.handleHttp(makeJsonReq('POST', '/push/subscribe', { endpoint: 'https://push.example/abc', keys: {} }), res);
      await res.finished;
      assert.equal(res.statusCode, 200);
      assert.equal(server.push.added.length, 1);
    });

    test('POST /push/subscribe rejects a body without an endpoint', async () => {
      const server = makeServer();
      const res = makeRes();
      server.handleHttp(makeJsonReq('POST', '/push/subscribe', { nope: true }), res);
      await res.finished;
      assert.equal(res.statusCode, 400);
    });

    test('POST /push/unsubscribe removes by endpoint', async () => {
      const server = makeServer();
      const res = makeRes();
      server.handleHttp(makeJsonReq('POST', '/push/unsubscribe', { endpoint: 'https://push.example/abc' }), res);
      await res.finished;
      assert.equal(res.statusCode, 200);
      assert.deepEqual(server.push.removed, ['https://push.example/abc']);
    });

    test('unknown push route is a 404', async () => {
      const server = makeServer();
      const res = makeRes();
      server.handleHttp({ url: '/push/bogus', method: 'GET', headers: {} }, res);
      await res.finished;
      assert.equal(res.statusCode, 404);
    });
  });

  describe('pushPayloadFor', () => {
    test('blocked events say the agent needs attention', () => {
      const payload = HerdrWebServer.pushPayloadFor({ agent: 'claude', title: 'fix bug', paneId: 'w1:p1', to: 'blocked' });
      assert.deepEqual(payload, { title: 'claude needs attention', body: 'fix bug', tag: 'w1:p1' });
    });

    test('finished events include the new state and fall back to pane id', () => {
      const payload = HerdrWebServer.pushPayloadFor({ paneId: 'w1:p1', to: 'idle', from: 'working' });
      assert.deepEqual(payload, { title: 'agent finished (idle)', body: 'w1:p1', tag: 'w1:p1' });
    });

    test('routine transitions name both ends so the device can tell them apart', () => {
      const payload = HerdrWebServer.pushPayloadFor({ agent: 'claude', paneId: 'w1:p1', to: 'working', from: 'idle' });
      assert.deepEqual(payload, { title: 'claude: idle \u2192 working', body: 'w1:p1', tag: 'w1:p1' });
    });
  });

  describe('send', () => {
    test('skips sockets that are not open', () => {
      const server = makeServer();
      const socket = makeSocket();
      socket.readyState = 3;
      server.send(socket, { type: 'topology' });
      assert.deepEqual(socket.sent, []);
    });
  });
});
