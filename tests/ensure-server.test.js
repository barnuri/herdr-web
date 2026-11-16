'use strict';

const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'ensure-server.sh');

// A stand-in server.js: answers HTTP on HERDR_WEB_PORT and records each launch.
const FAKE_SERVER = `
const fs = require('fs');
const http = require('http');
fs.appendFileSync(process.env.LAUNCHES_FILE, JSON.stringify({
  pid: process.pid,
  cwd: process.cwd(),
  stateDir: process.env.HERDR_PLUGIN_STATE_DIR,
  pluginId: process.env.HERDR_PLUGIN_ID,
}) + '\\n');
http.createServer((req, res) => res.end('ok')).listen(Number(process.env.HERDR_WEB_PORT), '127.0.0.1');
`;

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function readLaunches(file) {
  if (!fs.existsSync(file)) { return []; }
  return fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

describe('scripts/ensure-server.sh', () => {
  let tempDir;
  let pluginDir;
  let stateDir;
  let launchesFile;
  let port;
  let env;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'herdr-web-ensure-test-'));
    pluginDir = path.join(tempDir, 'plugin');
    stateDir = path.join(tempDir, 'state');
    launchesFile = path.join(tempDir, 'launches.jsonl');
    fs.mkdirSync(pluginDir);
    fs.writeFileSync(path.join(pluginDir, 'server.js'), FAKE_SERVER);
    port = await freePort();
    env = {
      ...process.env,
      HERDR_PLUGIN_ROOT: pluginDir,
      HERDR_PLUGIN_CONFIG_DIR: path.join(tempDir, 'config'),
      // the hook's own state dir must be ignored in favour of the pinned one
      HERDR_PLUGIN_STATE_DIR: path.join(tempDir, 'hook-state'),
      HERDR_WEB_STATE_DIR: stateDir,
      HERDR_WEB_PORT: String(port),
      HERDR_WEB_HOST: '127.0.0.1',
      LAUNCHES_FILE: launchesFile,
    };
  });

  afterEach(() => {
    for (const launch of readLaunches(launchesFile)) {
      try { process.kill(launch.pid, 'SIGTERM'); } catch { /* already gone */ }
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function runEnsure() {
    return spawnSync('bash', [SCRIPT], { env, encoding: 'utf8', timeout: 20000 });
  }

  test('starts server.js from the plugin dir with the plugin env when nothing answers', () => {
    const result = runEnsure();
    assert.equal(result.status, 0, result.stderr);

    const launches = readLaunches(launchesFile);
    assert.equal(launches.length, 1);
    assert.equal(fs.realpathSync(launches[0].cwd), fs.realpathSync(pluginDir));
    assert.equal(launches[0].stateDir, stateDir);
    assert.equal(launches[0].pluginId, 'barnuri.herdr-web');
    assert.match(fs.readFileSync(path.join(stateDir, 'server.log'), 'utf8'), /starting server\.js/);
    assert.equal(fs.existsSync(path.join(stateDir, 'ensure.lock')), false, 'lock is released');
    assert.equal(fs.existsSync(path.join(tempDir, 'hook-state')), false, 'hook state dir is not used');
  });

  test('is idempotent: does nothing when the server already answers', () => {
    assert.equal(runEnsure().status, 0);
    assert.equal(runEnsure().status, 0);
    assert.equal(runEnsure().status, 0);
    assert.equal(readLaunches(launchesFile).length, 1);
  });

  test('single flight: a held lock means another run is starting the server', () => {
    fs.mkdirSync(path.join(stateDir, 'ensure.lock'), { recursive: true });
    assert.equal(runEnsure().status, 0);
    assert.equal(readLaunches(launchesFile).length, 0);
    assert.equal(fs.existsSync(path.join(stateDir, 'ensure.lock')), true, 'a live lock is left alone');
  });

  test('a stale lock does not block healing', () => {
    const lock = path.join(stateDir, 'ensure.lock');
    fs.mkdirSync(lock, { recursive: true });
    const old = new Date(Date.now() - 5 * 60 * 1000);
    fs.utimesSync(lock, old, old);
    assert.equal(runEnsure().status, 0);
    assert.equal(readLaunches(launchesFile).length, 1);
  });
});
