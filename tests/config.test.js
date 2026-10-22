'use strict';

const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { DEFAULTS, configDir, configPath, loadConfig } = require('../lib/config');

const ENV_KEYS = ['HERDR_PLUGIN_CONFIG_DIR', 'HERDR_WEB_HOST', 'HERDR_WEB_PORT'];

describe('config', () => {
  let savedEnv;
  let tempDirs;

  beforeEach(() => {
    savedEnv = {};
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    tempDirs = [];
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = savedEnv[key];
      }
    }
    for (const dir of tempDirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  function useTempConfigDir() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'herdr-web-config-test-'));
    tempDirs.push(dir);
    process.env.HERDR_PLUGIN_CONFIG_DIR = dir;
    return dir;
  }

  function writeConfigFile(dir, contents) {
    const raw = typeof contents === 'string' ? contents : JSON.stringify(contents);
    fs.writeFileSync(path.join(dir, 'config.json'), raw);
  }

  describe('DEFAULTS', () => {
    test('has the documented default values', () => {
      assert.deepEqual(DEFAULTS, {
        host: '127.0.0.1',
        port: 7936,
        topologyPollMs: 2000,
        allowedOrigins: [],
        herdrArgs: [],
        clientBidi: 'auto',
      });
    });

    test('non-numeric poll values fall back to defaults', () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'herdr-web-config-'));
      fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ topologyPollMs: 'fast' }));
      process.env.HERDR_PLUGIN_CONFIG_DIR = dir;
      assert.equal(loadConfig().topologyPollMs, DEFAULTS.topologyPollMs);
    });

    test('non-array allowedOrigins falls back to default', () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'herdr-web-config-'));
      fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ allowedOrigins: 'not-a-list' }));
      process.env.HERDR_PLUGIN_CONFIG_DIR = dir;
      const config = loadConfig();
      assert.deepEqual(config.allowedOrigins, []);
    });
  });

  describe('configDir / configPath', () => {
    test('configDir honors HERDR_PLUGIN_CONFIG_DIR', () => {
      const dir = useTempConfigDir();
      assert.equal(configDir(), dir);
      assert.equal(configPath(), path.join(dir, 'config.json'));
    });

    test('configDir falls back to ~/.config/herdr-web without the env var', () => {
      assert.equal(configDir(), path.join(os.homedir(), '.config', 'herdr-web'));
    });
  });

  describe('loadConfig', () => {
    test('returns pure defaults when no config file exists', () => {
      useTempConfigDir();
      assert.deepEqual(loadConfig(), DEFAULTS);
    });

    test('merges config file values over defaults', () => {
      const dir = useTempConfigDir();
      writeConfigFile(dir, { port: 8080 });
      const config = loadConfig();
      assert.equal(config.port, 8080);
      assert.equal(config.host, DEFAULTS.host);
      assert.equal(config.topologyPollMs, DEFAULTS.topologyPollMs);
    });

    test('HERDR_WEB_HOST and HERDR_WEB_PORT override file values', () => {
      const dir = useTempConfigDir();
      writeConfigFile(dir, { host: '0.0.0.0', port: 8080 });
      process.env.HERDR_WEB_HOST = '192.168.1.10';
      process.env.HERDR_WEB_PORT = '9000';
      const config = loadConfig();
      assert.equal(config.host, '192.168.1.10');
      assert.equal(config.port, 9000);
    });

    test('non-numeric HERDR_WEB_PORT is ignored', () => {
      useTempConfigDir();
      process.env.HERDR_WEB_PORT = 'not-a-port';
      assert.equal(loadConfig().port, DEFAULTS.port);
    });

    test('out-of-range port falls back to the default port', () => {
      const dir = useTempConfigDir();
      writeConfigFile(dir, { port: 70000 });
      assert.equal(loadConfig().port, DEFAULTS.port);
    });

    test('port 0 and negative ports fall back to the default port', () => {
      useTempConfigDir();
      process.env.HERDR_WEB_PORT = '0';
      assert.equal(loadConfig().port, DEFAULTS.port);
      process.env.HERDR_WEB_PORT = '-1';
      assert.equal(loadConfig().port, DEFAULTS.port);
    });

    test('non-integer port from the file falls back to the default port', () => {
      const dir = useTempConfigDir();
      writeConfigFile(dir, { port: '8080' });
      assert.equal(loadConfig().port, DEFAULTS.port);
    });

    test('poll intervals are clamped to at least 250ms', () => {
      const dir = useTempConfigDir();
      writeConfigFile(dir, { topologyPollMs: 100 });
      assert.equal(loadConfig().topologyPollMs, 250);
    });

    test('poll intervals above the minimum pass through unchanged', () => {
      const dir = useTempConfigDir();
      writeConfigFile(dir, { topologyPollMs: 5000 });
      assert.equal(loadConfig().topologyPollMs, 5000);
    });


    test('clientBidi can be turned off', () => {
      const dir = useTempConfigDir();
      writeConfigFile(dir, { clientBidi: false });
      assert.equal(loadConfig().clientBidi, false);
    });

    test('clientBidi accepts auto', () => {
      const dir = useTempConfigDir();
      writeConfigFile(dir, { clientBidi: 'auto' });
      assert.equal(loadConfig().clientBidi, 'auto');
    });

    test('unknown clientBidi values fall back to auto', () => {
      const dir = useTempConfigDir();
      writeConfigFile(dir, { clientBidi: 'no' });
      assert.equal(loadConfig().clientBidi, 'auto');
    });

    test('corrupt JSON in the config file keeps defaults', () => {
      const dir = useTempConfigDir();
      writeConfigFile(dir, '{ this is not json');
      assert.deepEqual(loadConfig(), DEFAULTS);
    });

    test('returned config object is frozen', () => {
      useTempConfigDir();
      const config = loadConfig();
      assert.equal(Object.isFrozen(config), true);
      assert.throws(() => {
        config.port = 1234;
      }, TypeError);
    });

    test('loadConfig does not mutate DEFAULTS', () => {
      const dir = useTempConfigDir();
      writeConfigFile(dir, { port: 8080 });
      loadConfig();
      assert.equal(DEFAULTS.port, 7936);
    });
  });
});
