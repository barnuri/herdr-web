'use strict';

const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const DEFAULT_ENV_ID = 'default';
const ENV_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const MAX_REGISTRY_FILE_BYTES = 4 * 1024;
const MAX_REGISTRY_FILES = 32;
const MAX_LABEL_LENGTH = 40;
const HEALTH_TIMEOUT_MS = 1000;
const CACHE_MS = 5000;
const SOCKET_RELATIVE = path.join('.config', 'herdr', 'herdr.sock');

function registryDir(env = process.env) {
  return env.HERDR_WEB_ENVS_DIR || path.join(os.homedir(), '.config', 'herdr-web', 'envs.d');
}

function orchHome(env = process.env) {
  return env.HARNESS_ORCH_HOME || path.join(os.homedir(), '.harness-orch');
}

function isAbsoluteClean(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 400 && path.isAbsolute(value) && !value.includes('\0');
}

function socketHealthy(socketPath, timeoutMs = HEALTH_TIMEOUT_MS) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok) => {
      if (settled) {
        return;
      }
      settled = true;
      client.destroy();
      resolve(ok);
    };
    const client = net.connect(socketPath);
    client.setTimeout(timeoutMs, () => finish(false));
    client.once('connect', () => finish(true));
    client.once('error', () => finish(false));
  });
}

function makeEnv({ id, label, home, socket, isDefault = false }) {
  return {
    id,
    label,
    home,
    socket: socket || path.join(home, SOCKET_RELATIVE),
    explicitSocket: Boolean(socket),
    default: isDefault,
  };
}

// The child environment for any herdr process aimed at this env. The default env keeps the
// plugin's own environment untouched, which is the behaviour before envs existed.
function childEnvFor(envInfo, base = process.env) {
  if (!envInfo || envInfo.default) {
    return { ...base };
  }
  const env = { ...base };
  for (const key of Object.keys(env)) {
    if (key.startsWith('HERDR_') && key !== 'HERDR_BIN_PATH') {
      delete env[key];
    }
  }
  env.HOME = envInfo.home;
  env.HERDR_SOCKET_PATH = envInfo.socket;
  return env;
}

function defaultEnv(base = process.env) {
  const home = os.homedir();
  const socket = base.HERDR_SOCKET_PATH || path.join(home, SOCKET_RELATIVE);
  return { ...makeEnv({ id: DEFAULT_ENV_ID, label: 'default', home, socket, isDefault: true }), explicitSocket: false };
}

function readRegistry(dir) {
  let names;
  try {
    names = fs.readdirSync(dir).filter((name) => name.endsWith('.json')).sort().slice(0, MAX_REGISTRY_FILES);
  } catch {
    return [];
  }
  const out = [];
  for (const name of names) {
    try {
      const file = path.join(dir, name);
      const stat = fs.statSync(file);
      if (!stat.isFile() || stat.size > MAX_REGISTRY_FILE_BYTES) {
        continue;
      }
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!data || typeof data !== 'object' || typeof data.id !== 'string' || !ENV_ID_PATTERN.test(data.id)) {
        continue;
      }
      if (typeof data.label !== 'string' || data.label.trim() === '' || !isAbsoluteClean(data.home)) {
        continue;
      }
      if (data.socket !== undefined && !isAbsoluteClean(data.socket)) {
        continue;
      }
      out.push(makeEnv({ id: data.id, label: data.label.trim().slice(0, MAX_LABEL_LENGTH), home: data.home, socket: data.socket }));
    } catch {
      // an unreadable or corrupt file is skipped, never fatal
    }
  }
  return out;
}

// The orch skill keeps a dedicated headless herdr under <orch-home>/herdr/home. When that path
// makes the socket too long it reaches the same home through /tmp/orch-herdr-<uid>-<cksum>.
function orchCandidates(env = process.env) {
  const real = path.join(orchHome(env), 'herdr', 'home');
  const homes = [real];
  try {
    const prefix = `orch-herdr-${process.getuid ? process.getuid() : ''}-`;
    for (const name of fs.readdirSync('/tmp')) {
      if (!name.startsWith(prefix)) {
        continue;
      }
      try {
        if (fs.realpathSync(path.join('/tmp', name)) === fs.realpathSync(real)) {
          homes.unshift(path.join('/tmp', name));
        }
      } catch {
        // dangling link
      }
    }
  } catch {
    // no /tmp listing
  }
  return homes.map((home) => makeEnv({ id: 'orch', label: 'orch', home }));
}

class EnvRegistry {
  constructor({ env = process.env, now = Date.now, probe = socketHealthy } = {}) {
    this.env = env;
    this.now = now;
    this.probe = probe;
    this.cache = null;
    this.pending = null;
  }

  async list() {
    if (this.cache && this.now() - this.cache.at < CACHE_MS) {
      return this.cache.envs;
    }
    if (!this.pending) {
      this.pending = this.discover()
        .catch(() => [{ ...defaultEnv(this.env), reachable: true }])
        .then((envs) => {
          this.cache = { at: this.now(), envs };
          this.pending = null;
          return envs;
        });
    }
    return this.pending;
  }

  async discover() {
    const candidates = [defaultEnv(this.env)];
    const seen = new Set([DEFAULT_ENV_ID]);
    const add = (candidate) => {
      if (!seen.has(candidate.id)) {
        seen.add(candidate.id);
        candidates.push(candidate);
      }
    };
    for (const entry of readRegistry(registryDir(this.env))) {
      add(entry);
    }
    const orchList = orchCandidates(this.env);
    const probed = await Promise.all(candidates.map(async (candidate) => ({ ...candidate, reachable: await this.probe(candidate.socket) })));
    // A registry entry for the orch instance (orch writes envs.d/orch-skill.json) replaces the
    // auto-discovered "orch" env, so the same server is not listed twice.
    const real = (p) => {
      try {
        return fs.realpathSync(p);
      } catch {
        return p;
      }
    };
    const orchHomes = new Set(orchList.map((candidate) => real(candidate.home)));
    const taken = probed.find((candidate) => candidate.id === 'orch' || (!candidate.default && orchHomes.has(real(candidate.home))));
    if (!taken) {
      for (const candidate of orchList) {
        if (await this.probe(candidate.socket)) {
          probed.push({ ...candidate, reachable: true });
          break;
        }
      }
    }
    // the default env is always listed so a dead default does not hide the others' labels
    return probed;
  }

  async available() {
    return (await this.list()).filter((candidate) => candidate.reachable);
  }

  async publicList() {
    const all = await this.list();
    return all.map(({ id, label, default: isDefault, reachable }) => ({ id, label, default: isDefault, reachable }));
  }

  // id comes from the client: only a discovered id maps to a socket/home, never a path.
  async resolve(id) {
    if (id === undefined || id === null || id === '') {
      return (await this.list()).find((candidate) => candidate.default) || defaultEnv(this.env);
    }
    if (typeof id !== 'string' || !ENV_ID_PATTERN.test(id)) {
      return null;
    }
    return (await this.list()).find((candidate) => candidate.id === id) || null;
  }

  invalidate() {
    this.cache = null;
  }
}

module.exports = { EnvRegistry, DEFAULT_ENV_ID, ENV_ID_PATTERN, childEnvFor, defaultEnv, socketHealthy, readRegistry, registryDir, orchCandidates };
