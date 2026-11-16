'use strict';

const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');

const { EnvRegistry, childEnvFor, readRegistry } = require('../lib/envs');
const { HerdrWebServer } = require('../server');

// unix socket paths must stay short, so these live under /tmp rather than os.tmpdir()
describe('env discovery', () => {
  let root;
  let listeners;
  let registryDir;
  let baseEnv;

  function listen(socketPath) {
    fs.mkdirSync(path.dirname(socketPath), { recursive: true });
    const server = net.createServer((conn) => conn.end());
    listeners.push(server);
    return new Promise((resolve) => server.listen(socketPath, () => resolve(server)));
  }

  function register(name, body) {
    fs.mkdirSync(registryDir, { recursive: true });
    fs.writeFileSync(path.join(registryDir, name), typeof body === 'string' ? body : JSON.stringify(body));
  }

  function makeRegistry() {
    return new EnvRegistry({ env: baseEnv });
  }

  beforeEach(async () => {
    root = fs.mkdtempSync('/tmp/hw-env-');
    listeners = [];
    registryDir = path.join(root, 'envs.d');
    baseEnv = {
      HERDR_SOCKET_PATH: path.join(root, 'def', 'herdr.sock'),
      HERDR_WEB_ENVS_DIR: registryDir,
      HARNESS_ORCH_HOME: path.join(root, 'orch'),
    };
    await listen(baseEnv.HERDR_SOCKET_PATH);
  });

  afterEach(() => {
    for (const server of listeners) {
      server.close();
    }
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('default only gives one available env', async () => {
    const registry = makeRegistry();
    const list = await registry.publicList();
    assert.deepEqual(list, [{ id: 'default', label: 'default', default: true, reachable: true }]);
    assert.equal((await registry.available()).length, 1);
  });

  test('a registry file adds a reachable env', async () => {
    const home = path.join(root, 'h1');
    await listen(path.join(home, '.config', 'herdr', 'herdr.sock'));
    register('one.json', { id: 'one', label: 'One', home });
    const list = await makeRegistry().publicList();
    assert.deepEqual(list.map((e) => [e.id, e.reachable]), [['default', true], ['one', true]]);
  });

  test('an explicit socket in the registry is used', async () => {
    const socket = path.join(root, 'custom.sock');
    await listen(socket);
    register('x.json', { id: 'x', label: 'X', home: root, socket });
    const env = await makeRegistry().resolve('x');
    assert.equal(env.socket, socket);
    assert.equal(childEnvFor(env, {}).HERDR_SOCKET_PATH, socket);
  });

  test('an unreachable env is listed but not available', async () => {
    register('dead.json', { id: 'dead', label: 'Dead', home: path.join(root, 'nope') });
    const registry = makeRegistry();
    assert.equal((await registry.publicList()).find((e) => e.id === 'dead').reachable, false);
    assert.deepEqual((await registry.available()).map((e) => e.id), ['default']);
  });

  test('invalid, oversized and corrupt registry files are ignored', async () => {
    register('bad-id.json', { id: '../etc', label: 'x', home: root });
    register('rel-home.json', { id: 'rel', label: 'x', home: 'relative/path' });
    register('no-label.json', { id: 'nolabel', home: root });
    register('corrupt.json', '{not json');
    register('big.json', JSON.stringify({ id: 'big', label: 'x'.repeat(10000), home: root }));
    register('notes.txt', 'ignored');
    assert.deepEqual(readRegistry(registryDir), []);
    assert.deepEqual((await makeRegistry().publicList()).map((e) => e.id), ['default']);
  });

  test('a registry file cannot shadow the default id', async () => {
    register('d.json', { id: 'default', label: 'Evil', home: root });
    const list = await makeRegistry().publicList();
    assert.equal(list.length, 1);
    assert.equal(list[0].label, 'default');
  });

  test('the orch instance appears only when its socket answers', async () => {
    assert.deepEqual((await makeRegistry().publicList()).map((e) => e.id), ['default']);
    await listen(path.join(root, 'orch', 'herdr', 'home', '.config', 'herdr', 'herdr.sock'));
    const list = await makeRegistry().publicList();
    assert.deepEqual(list.map((e) => [e.id, e.label]), [['default', 'default'], ['orch', 'orch']]);
  });

  test('a registry entry for the orch instance replaces the auto-discovered orch env', async () => {
    const home = path.join(root, 'orch', 'herdr', 'home');
    await listen(path.join(home, '.config', 'herdr', 'herdr.sock'));
    register('orch-skill.json', { id: 'orch-skill', label: 'orch-skill', home });
    const list = await makeRegistry().publicList();
    assert.deepEqual(list.map((e) => [e.id, e.reachable]), [['default', true], ['orch-skill', true]]);
  });

  test('results are cached for a few seconds and invalidate refreshes', async () => {
    let clock = 1000;
    const registry = new EnvRegistry({ env: baseEnv, now: () => clock });
    assert.equal((await registry.list()).length, 1);
    register('late.json', { id: 'late', label: 'Late', home: root, socket: baseEnv.HERDR_SOCKET_PATH });
    assert.equal((await registry.list()).length, 1);
    clock += 6000;
    assert.equal((await registry.list()).length, 2);
  });

  test('discovery never throws', async () => {
    const registry = new EnvRegistry({ env: baseEnv, probe: async () => { throw new Error('boom'); } });
    const list = await registry.publicList();
    assert.equal(list[0].id, 'default');
  });

  test('resolve rejects unknown and path-like ids', async () => {
    const registry = makeRegistry();
    assert.equal((await registry.resolve(undefined)).id, 'default');
    for (const bad of ['nope', '../x', '/etc/passwd', 'a/b', 'A', '.', 'x'.repeat(40), ['a']]) {
      assert.equal(await registry.resolve(bad), null, String(bad));
    }
  });

  test('childEnvFor points a non-default env at its own home and socket', () => {
    const env = childEnvFor({ default: false, home: '/h', socket: '/h/s.sock' }, { PATH: '/bin', HERDR_PANE_ID: 'p', HERDR_ENV: '1', HOME: '/real' });
    assert.equal(env.HOME, '/h');
    assert.equal(env.HERDR_SOCKET_PATH, '/h/s.sock');
    assert.equal(env.HERDR_PANE_ID, undefined);
    assert.equal(env.PATH, '/bin');
    assert.equal(childEnvFor({ default: true }, { HOME: '/real' }).HOME, '/real');
  });
});

describe('env routing in the server', () => {
  const fakeRegistry = {
    async publicList() { return [{ id: 'default', label: 'default', default: true, reachable: true }, { id: 'orch', label: 'orch', default: false, reachable: true }]; },
    async resolve(id) {
      if (!id) { return { id: 'default', default: true }; }
      return id === 'orch' ? { id: 'orch', default: false, home: '/h', socket: '/h/s' } : null;
    },
  };
  const push = { publicKey: 'k' };

  function respond() {
    return { status: null, body: '', writeHead(code) { this.status = code; }, end(text) { this.body = text || ''; } };
  }

  test('GET /api/envs returns the public list', async () => {
    const server = new HerdrWebServer({ host: '127.0.0.1', port: 0, allowedOrigins: [] }, push, fakeRegistry);
    const res = respond();
    server.handleHttp({ url: '/api/envs', method: 'GET', headers: {} }, res);
    await new Promise((r) => setImmediate(r));
    assert.equal(res.status, 200);
    assert.deepEqual(JSON.parse(res.body).map((e) => e.id), ['default', 'orch']);
  });

  test('websocket upgrade: known env passes, unknown and path-like are 400', async () => {
    const server = new HerdrWebServer({ host: '127.0.0.1', port: 0, allowedOrigins: [] }, push, fakeRegistry);
    const verify = (url) => new Promise((resolve) => {
      const req = { url, headers: {} };
      server.verifyClient(undefined, req, (ok, code) => resolve({ ok, code, env: req.herdrEnv }));
    });
    assert.equal((await verify('/ws?device=desktop')).ok, true);
    assert.equal((await verify('/ws?env=orch')).env.id, 'orch');
    assert.deepEqual((await verify('/ws?env=nope')).code, 400);
    assert.deepEqual((await verify('/ws?env=..%2F..%2Fetc')).code, 400);
  });

  test('image upload with an unknown env is 400', async () => {
    const server = new HerdrWebServer({ host: '127.0.0.1', port: 0, allowedOrigins: [] }, push, fakeRegistry);
    const res = respond();
    server.handleHttp({ url: '/images?env=nope', method: 'POST', headers: {} }, res);
    await new Promise((r) => setImmediate(r));
    assert.equal(res.status, 400);
  });
});
