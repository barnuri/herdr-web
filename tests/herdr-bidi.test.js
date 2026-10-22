'use strict';

const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { herdrBidiEnabled, herdrConfigPath, resolveClientBidi } = require('../lib/herdr-bidi');

describe('herdr-bidi', () => {
  let dir;
  let savedConfigPath;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'herdr-web-bidi-test-'));
    savedConfigPath = process.env.HERDR_CONFIG_PATH;
    delete process.env.HERDR_CONFIG_PATH;
  });

  afterEach(() => {
    if (savedConfigPath === undefined) {
      delete process.env.HERDR_CONFIG_PATH;
    } else {
      process.env.HERDR_CONFIG_PATH = savedConfigPath;
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function writeHerdrConfig(toml) {
    const file = path.join(dir, 'config.toml');
    fs.writeFileSync(file, toml);
    return file;
  }

  describe('herdrBidiEnabled', () => {
    test('is false when the herdr config is missing', () => {
      assert.equal(herdrBidiEnabled(path.join(dir, 'missing.toml')), false);
    });

    test('is false when [ui] has no pane_transforms', () => {
      assert.equal(herdrBidiEnabled(writeHerdrConfig('[ui]\ntheme = "dark"\n')), false);
    });

    test('is false for an empty pane_transforms list', () => {
      assert.equal(herdrBidiEnabled(writeHerdrConfig('[ui]\npane_transforms = []\n')), false);
    });

    test('is true when [ui] pane_transforms lists bidi', () => {
      assert.equal(herdrBidiEnabled(writeHerdrConfig('[ui]\npane_transforms = ["bidi"]\n')), true);
    });

    test('reads a list that spans several lines', () => {
      const file = writeHerdrConfig('[ui]\npane_transforms = [\n  "other",\n  \'bidi\', # rtl\n]\n');
      assert.equal(herdrBidiEnabled(file), true);
    });

    test('reads the dotted top-level form', () => {
      assert.equal(herdrBidiEnabled(writeHerdrConfig('ui.pane_transforms = ["bidi"]\n')), true);
    });

    test('ignores pane_transforms under another table', () => {
      assert.equal(herdrBidiEnabled(writeHerdrConfig('[terminal]\npane_transforms = ["bidi"]\n')), false);
    });

    test('ignores a commented-out setting', () => {
      assert.equal(herdrBidiEnabled(writeHerdrConfig('[ui]\n# pane_transforms = ["bidi"]\n')), false);
    });
  });

  describe('herdrConfigPath', () => {
    test('honours HERDR_CONFIG_PATH', () => {
      process.env.HERDR_CONFIG_PATH = '/custom/herdr.toml';
      assert.equal(herdrConfigPath(), '/custom/herdr.toml');
    });
  });

  describe('resolveClientBidi', () => {
    test('auto turns client BiDi off when herdr reorders rows itself', () => {
      assert.equal(resolveClientBidi('auto', writeHerdrConfig('[ui]\npane_transforms = ["bidi"]\n')), false);
    });

    test('auto keeps client BiDi on when herdr does not', () => {
      assert.equal(resolveClientBidi('auto', writeHerdrConfig('[ui]\n')), true);
    });

    test('explicit booleans win over detection', () => {
      const file = writeHerdrConfig('[ui]\npane_transforms = ["bidi"]\n');
      assert.equal(resolveClientBidi(true, file), true);
      assert.equal(resolveClientBidi(false, file), false);
    });
  });
});
