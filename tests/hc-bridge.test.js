'use strict';

const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const EventEmitter = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { HcBridge, HcError, rpc } = require('../lib/hc-bridge');

// A stand-in for `hc`: `connect` answers JSON-RPC lines, `attach <t>` echoes its input.
// Both are shell: a node process here takes 1 to 4 s to start, which turns every call slow.
function fakeHcScript() {
  return `#!/bin/sh
if [ "$1" = attach ]; then
  echo "ATTACHED $2"
  cat
  exit 0
fi
if [ "$1" = run ]; then
  echo "$@" > "$(dirname "$0")/run-args"
  echo '{"address":"t9","state":"live"}'
  exit 0
fi
input=$(cat)
case "$input" in
  *'"method":"terminal.list"'*)
    echo '{"id":2,"jsonrpc":"2.0","result":{"terminals":[{"address":"t1"}],"hidden_finished":0}}' ;;
  *'"method":"terminal.kill"'*)
    echo '{"id":2,"jsonrpc":"2.0","result":{"address":"t1","state":"finished"}}' ;;
  *'"method":"terminal.read"'*)
    t=$(printf '%s' "$input" | sed -n 's/.*"terminal":"\\([^"]*\\)".*/\\1/p')
    echo "{\\"id\\":2,\\"jsonrpc\\":\\"2.0\\",\\"result\\":{\\"complete\\":true,\\"how\\":\\"screen\\",\\"text\\":\\"hi $t\\"}}" ;;
  *)
    echo '{"id":2,"jsonrpc":"2.0","error":{"code":-32000,"message":"not_found","data":{"kind":"not_found"}}}' ;;
esac
`;
}

class FakeSocket extends EventEmitter {
  constructor() {
    super();
    this.OPEN = 1;
    this.readyState = 1;
    this.sent = [];
  }

  send(data) {
    this.sent.push(JSON.parse(data));
  }

  waitFor(predicate, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      const started = Date.now();
      const tick = () => {
        const found = this.sent.find(predicate);
        if (found) {
          resolve(found);
          return;
        }
        if (Date.now() - started > timeoutMs) {
          reject(new Error(`timed out; sent: ${JSON.stringify(this.sent)}`));
          return;
        }
        setTimeout(tick, 20);
      };
      tick();
    });
  }
}

describe('hc-bridge', () => {
  let dir;
  let bin;
  let sockets;

  // a fake socket per test; closing them ends any attach PTY a failed test left running
  function openSocket(bridge) {
    const socket = new FakeSocket();
    sockets.push(socket);
    bridge.onConnection(socket);
    return socket;
  }

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'herdr-web-hc-test-'));
    bin = path.join(dir, 'hc');
    fs.writeFileSync(bin, fakeHcScript(), { mode: 0o755 });
    sockets = [];
  });

  afterEach(() => {
    for (const socket of sockets) {
      socket.emit('close');
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('rpc returns the result of the call', async () => {
    const result = await rpc('terminal.list', { all: false }, { bin });
    assert.deepEqual(result, { terminals: [{ address: 't1' }], hidden_finished: 0 });
  });

  test('rpc rejects with HcError carrying the hc error kind', async () => {
    await assert.rejects(rpc('terminal.get', { terminal: 'nope' }, { bin }), (error) => {
      assert.ok(error instanceof HcError);
      assert.equal(error.kind, 'not_found');
      return true;
    });
  });

  test('rpc rejects when the binary is missing', async () => {
    await assert.rejects(rpc('terminal.list', {}, { bin: path.join(dir, 'missing') }), /ENOENT/);
  });

  test('list sends the terminals', async () => {
    const bridge = new HcBridge({ bin });
    const socket = openSocket(bridge);
    socket.emit('message', JSON.stringify({ type: 'list' }));
    const reply = await socket.waitFor((m) => m.type === 'terminals');
    assert.deepEqual(reply.terminals, [{ address: 't1' }]);
    assert.equal(reply.hidden_finished, 0);
  });

  test('read sends the screen text of a terminal', async () => {
    const bridge = new HcBridge({ bin });
    const socket = openSocket(bridge);
    socket.emit('message', JSON.stringify({ type: 'read', terminal: 't7', lines: 3 }));
    const reply = await socket.waitFor((m) => m.type === 'read');
    assert.deepEqual(reply, { type: 'read', terminal: 't7', text: 'hi t7', complete: true });
  });

  test('a request missing a field is reported as an error message, not thrown', async () => {
    const bridge = new HcBridge({ bin });
    const socket = openSocket(bridge);
    socket.emit('message', JSON.stringify({ type: 'read' }));
    const reply = await socket.waitFor((m) => m.type === 'error' && m.request === 'read');
    assert.match(reply.message, /terminal must be a terminal address/);
  });

  test('invalid JSON and unknown types are reported', async () => {
    const bridge = new HcBridge({ bin });
    const socket = openSocket(bridge);
    socket.emit('message', 'not json');
    socket.emit('message', JSON.stringify({ type: 'bogus' }));
    await socket.waitFor((m) => m.message === 'invalid JSON');
    await socket.waitFor((m) => m.message === 'unknown message type: bogus');
  });

  test('attach streams the output, forwards input and reports the exit', async () => {
    const bridge = new HcBridge({ bin });
    const socket = openSocket(bridge);
    socket.emit('message', JSON.stringify({ type: 'attach', terminal: 't1', cols: 80, rows: 24 }));
    await socket.waitFor((m) => m.type === 'attached' && m.terminal === 't1');
    await socket.waitFor((m) => m.type === 'output' && m.data.includes('ATTACHED t1'));
    socket.emit('message', JSON.stringify({ type: 'resize', cols: 100, rows: 30 }));
    socket.emit('message', JSON.stringify({ type: 'input', data: 'ping' }));
    await socket.waitFor((m) => m.type === 'output' && m.data.includes('ping'));
    socket.emit('close');
    assert.equal(bridge.sessionBySocket.has(socket), false);
  });

  test('input and resize without an attached terminal are ignored', () => {
    const bridge = new HcBridge({ bin });
    const socket = openSocket(bridge);
    socket.emit('message', JSON.stringify({ type: 'input', data: 'x' }));
    socket.emit('message', JSON.stringify({ type: 'resize', cols: 10, rows: 10 }));
    socket.emit('message', JSON.stringify({ type: 'detach' }));
    assert.deepEqual(socket.sent, []);
  });

  test('attach without a terminal is an error', async () => {
    const bridge = new HcBridge({ bin });
    const socket = openSocket(bridge);
    socket.emit('message', JSON.stringify({ type: 'attach', cols: 80, rows: 24 }));
    await socket.waitFor((m) => m.type === 'error' && m.request === 'attach');
    assert.equal(bridge.sessionBySocket.size, 0);
  });

  test('world sends the app spaces and the live terminals', async () => {
    const appBin = path.join(dir, 'herdr-app');
    fs.writeFileSync(appBin, `#!/bin/sh\necho '{"spaces":[{"id":"sp1","name":"proj","tabs":[]}]}'\n`, { mode: 0o755 });
    const bridge = new HcBridge({ bin, appBin });
    const socket = openSocket(bridge);
    socket.emit('message', JSON.stringify({ type: 'world' }));
    const reply = await socket.waitFor((m) => m.type === 'world');
    assert.deepEqual(reply.spaces, [{ id: 'sp1', name: 'proj', tabs: [] }]);
    assert.deepEqual(reply.terminals, [{ address: 't1' }]);
  });

  test('world sends null spaces when herdr-app is missing', async () => {
    const bridge = new HcBridge({ bin, appBin: path.join(dir, 'missing') });
    const socket = openSocket(bridge);
    socket.emit('message', JSON.stringify({ type: 'world' }));
    const reply = await socket.waitFor((m) => m.type === 'world');
    assert.equal(reply.spaces, null);
  });

  test('run starts a kept shell labelled with the space and tab', async () => {
    const bridge = new HcBridge({ bin, shell: '/bin/zsh' });
    const socket = openSocket(bridge);
    socket.emit('message', JSON.stringify({ type: 'run', space: 'sp1', tab: 'tb1', cwd: '/tmp' }));
    const reply = await socket.waitFor((m) => m.type === 'ran');
    assert.equal(reply.terminal, 't9');
    const args = fs.readFileSync(path.join(dir, 'run-args'), 'utf8').trim();
    assert.equal(args, 'run --bg --keep --no-parent --json --label herdr.space=sp1 --label herdr.tab=tb1 --cwd /tmp -- /bin/zsh');
  });

  test('run refuses an id that is not a plain word', async () => {
    const bridge = new HcBridge({ bin });
    const socket = openSocket(bridge);
    socket.emit('message', JSON.stringify({ type: 'run', space: 'sp1 --rm', tab: 'tb1' }));
    const reply = await socket.waitFor((m) => m.type === 'error' && m.request === 'run');
    assert.match(reply.message, /space must be an id/);
    assert.equal(fs.existsSync(path.join(dir, 'run-args')), false);
  });

  test('kill ends the terminal and confirms it', async () => {
    const bridge = new HcBridge({ bin });
    const socket = openSocket(bridge);
    socket.emit('message', JSON.stringify({ type: 'kill', terminal: 't1' }));
    const reply = await socket.waitFor((m) => m.type === 'killed');
    assert.equal(reply.terminal, 't1');
  });
});
