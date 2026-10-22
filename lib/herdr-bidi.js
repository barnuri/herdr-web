'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const HERDR_CONFIG_PATH_ENV = 'HERDR_CONFIG_PATH';
const BIDI_TRANSFORM = 'bidi';
const TABLE_HEADER = /^\[([^\]]+)\]$/;
const UI_KEY = /^pane_transforms\s*=\s*(.*)$/;
const DOTTED_KEY = /^ui\.pane_transforms\s*=\s*(.*)$/;

function herdrConfigPath() {
  return process.env[HERDR_CONFIG_PATH_ENV] || path.join(os.homedir(), '.config', 'herdr', 'config.toml');
}

function stripComment(line) {
  return line.replace(/\s+#.*$/, '').replace(/^#.*$/, '').trim();
}

// the array value may span lines, so gather until its closing bracket
function readArrayValue(lines, start, firstPart) {
  let value = firstPart;
  for (let index = start + 1; !value.includes(']') && index < lines.length; index++) {
    value += ` ${stripComment(lines[index])}`;
  }
  return value;
}

function keyPatternFor(table) {
  if (table === 'ui') {
    return UI_KEY;
  }
  if (table === '') {
    return DOTTED_KEY;
  }
  return null;
}

function paneTransformsValue(toml) {
  const lines = toml.split(/\r?\n/);
  let table = '';
  for (let index = 0; index < lines.length; index++) {
    const line = stripComment(lines[index]);
    const header = TABLE_HEADER.exec(line);
    if (header) {
      table = header[1].trim();
      continue;
    }
    const match = keyPatternFor(table)?.exec(line);
    if (match) {
      return readArrayValue(lines, index, match[1]);
    }
  }
  return null;
}

/** True when herdr's own config turns on its BiDi row transform, so herdr already sends visual order. */
function herdrBidiEnabled(configPath = herdrConfigPath()) {
  let toml;
  try {
    toml = fs.readFileSync(configPath, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') {
      process.stderr.write(`herdr-web: cannot read herdr config at ${configPath}: ${error.message}\n`);
    }
    return false;
  }
  const value = paneTransformsValue(toml);
  if (value === null) {
    return false;
  }
  return new RegExp(`["']${BIDI_TRANSFORM}["']`).test(value);
}

/** Whether the browser should reorder RTL text: `auto` defers to herdr's own BiDi setting. */
function resolveClientBidi(setting, configPath = herdrConfigPath()) {
  if (setting === 'auto') {
    return !herdrBidiEnabled(configPath);
  }
  return setting;
}

module.exports = { herdrBidiEnabled, herdrConfigPath, resolveClientBidi };
