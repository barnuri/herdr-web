'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const DEFAULTS = {
  host: '127.0.0.1',
  port: 7936,
  topologyPollMs: 2000,
  allowedOrigins: [],
  herdrArgs: [],
  clientBidi: true,
};

const MIN_PORT = 1;
const MAX_PORT = 65535;
const MIN_POLL_MS = 250;

function configDir() {
  return process.env.HERDR_PLUGIN_CONFIG_DIR || path.join(os.homedir(), '.config', 'herdr-web');
}

function configPath() {
  return path.join(configDir(), 'config.json');
}

function readConfigFile() {
  const filePath = configPath();
  if (!fs.existsSync(filePath)) {
    return {};
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    process.stderr.write(`herdr-web: ignoring corrupt config at ${filePath}: ${error.message}\n`);
    return {};
  }
}

function applyEnvOverrides(config) {
  if (process.env.HERDR_WEB_HOST) {
    config.host = process.env.HERDR_WEB_HOST;
  }
  if (process.env.HERDR_WEB_PORT) {
    const port = Number.parseInt(process.env.HERDR_WEB_PORT, 10);
    if (!Number.isNaN(port)) {
      config.port = port;
    }
  }
}

function validate(config) {
  if (!Number.isInteger(config.port) || config.port < MIN_PORT || config.port > MAX_PORT) {
    process.stderr.write(`herdr-web: invalid port ${config.port}, using default ${DEFAULTS.port}\n`);
    config.port = DEFAULTS.port;
  }
  config.topologyPollMs = clampNumber(config.topologyPollMs, MIN_POLL_MS, Number.MAX_SAFE_INTEGER, DEFAULTS.topologyPollMs);
  if (!Array.isArray(config.allowedOrigins) || !config.allowedOrigins.every((origin) => typeof origin === 'string')) {
    config.allowedOrigins = DEFAULTS.allowedOrigins;
  }
  if (!Array.isArray(config.herdrArgs) || !config.herdrArgs.every((arg) => typeof arg === 'string')) {
    config.herdrArgs = DEFAULTS.herdrArgs;
  }
  if (typeof config.clientBidi !== 'boolean') {
    config.clientBidi = DEFAULTS.clientBidi;
  }
}

function clampNumber(value, min, max, fallback) {
  const isNumericInput = typeof value === 'number' || (typeof value === 'string' && value.trim() !== '');
  if (!isNumericInput) {
    return fallback;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, numeric));
}

function loadConfig() {
  const config = { ...DEFAULTS, ...readConfigFile() };
  applyEnvOverrides(config);
  validate(config);
  return Object.freeze(config);
}

module.exports = { DEFAULTS, configDir, configPath, loadConfig };
