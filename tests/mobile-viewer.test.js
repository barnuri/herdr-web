'use strict';

const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');

const { parseDevice, writeMobileViewer, mobileViewerPath } = require('../lib/mobile-viewer');
const { HerdrWebServer } = require('../server');

function makeFakeSocket() {
  const socket = new EventEmitter();
  socket.OPEN = 1;
  socket.readyState = 1;
  socket.send = () => {};
  return socket;
}

describe('parseDevice', () => {
  test('reads device=mobile from the query string', () => {
    assert.equal(parseDevice('/ws?device=mobile'), 'mobile');
  });

  test('defaults to desktop when device is missing or unknown', () => {
    assert.equal(parseDevice('/ws'), 'desktop');
    assert.equal(parseDevice('/ws?device=desktop'), 'desktop');
    assert.equal(parseDevice('/ws?device=tablet'), 'desktop');
    assert.equal(parseDevice(undefined), 'desktop');
  });
});

describe('mobileViewerPath', () => {
  test('uses HERDR_PLUGIN_STATE_DIR when set', () => {
    assert.equal(
      mobileViewerPath({ HERDR_PLUGIN_STATE_DIR: '/tmp/state' }),
      path.join('/tmp/state', 'mobile-viewer.json'),
    );
  });

  test('falls back to ~/.local/state/herdr-web', () => {
    assert.equal(
      mobileViewerPath({}),
      path.join(os.homedir(), '.local', 'state', 'herdr-web', 'mobile-viewer.json'),
    );
  });
});

describe('writeMobileViewer and server count tracking', () => {
  let stateDir;
  let previousEnv;

  beforeEach(() => {
    stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mobile-viewer-'));
    previousEnv = process.env.HERDR_PLUGIN_STATE_DIR;
    process.env.HERDR_PLUGIN_STATE_DIR = stateDir;
  });

  afterEach(() => {
    if (previousEnv === undefined) {
      delete process.env.HERDR_PLUGIN_STATE_DIR;
    } else {
      process.env.HERDR_PLUGIN_STATE_DIR = previousEnv;
    }
    fs.rmSync(stateDir, { recursive: true, force: true });
  });

  function readState() {
    return JSON.parse(fs.readFileSync(path.join(stateDir, 'mobile-viewer.json'), 'utf8'));
  }

  test('writes the count and an ISO UTC timestamp, leaving no temp files', () => {
    const filePath = path.join(stateDir, 'mobile-viewer.json');
    assert.equal(writeMobileViewer(2, filePath), true);
    const state = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    assert.equal(state.mobileAttached, 2);
    assert.match(state.updatedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    assert.deepEqual(fs.readdirSync(stateDir), ['mobile-viewer.json']);
  });

  test('returns false and does not throw when the write fails', () => {
    const blocker = path.join(stateDir, 'file-not-dir');
    fs.writeFileSync(blocker, 'x');
    const originalError = console.error;
    console.error = () => {};
    try {
      assert.equal(writeMobileViewer(1, path.join(blocker, 'mobile-viewer.json')), false);
    } finally {
      console.error = originalError;
    }
  });

  test('tracks mobile connects and disconnects, writing 0 when the last one leaves', () => {
    const server = new HerdrWebServer({ host: '127.0.0.1', port: 0, topologyPollMs: 1000, allowedOrigins: [] }, {
      publicKey: 'k',
      addSubscription() { return false; },
    });
    const mobileA = makeFakeSocket();
    const mobileB = makeFakeSocket();
    const desktop = makeFakeSocket();
    try {
      server.onConnection(mobileA, { url: '/ws?device=mobile' });
      assert.equal(readState().mobileAttached, 1);

      server.onConnection(desktop, { url: '/ws?device=desktop' });
      assert.equal(readState().mobileAttached, 1);

      server.onConnection(mobileB, { url: '/ws?device=mobile' });
      assert.equal(readState().mobileAttached, 2);

      server.dropClient(desktop);
      assert.equal(readState().mobileAttached, 2);

      server.dropClient(mobileA);
      assert.equal(readState().mobileAttached, 1);

      server.dropClient(mobileB);
      assert.equal(readState().mobileAttached, 0);
      assert.equal(server.mobileTimer, null);
    } finally {
      server.stopClipboardWatch();
    }
  });
});
