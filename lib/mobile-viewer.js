'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const FILE_NAME = 'mobile-viewer.json';

function stateDir(env = process.env) {
  return env.HERDR_PLUGIN_STATE_DIR || path.join(os.homedir(), '.local', 'state', 'herdr-web');
}

function mobileViewerPath(env = process.env) {
  return path.join(stateDir(env), FILE_NAME);
}

// Returns 'mobile' or 'desktop'. Anything missing or unrecognised counts as desktop.
function parseDevice(reqUrl) {
  let device;
  try {
    device = new URL(reqUrl || '/', 'http://localhost').searchParams.get('device');
  } catch {
    return 'desktop';
  }
  return device === 'mobile' ? 'mobile' : 'desktop';
}

// Writes {mobileAttached, updatedAt} atomically: temp file in the same dir, then rename.
// Returns false on failure and logs; never throws.
function writeMobileViewer(mobileAttached, filePath = mobileViewerPath()) {
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  const body = JSON.stringify({ mobileAttached, updatedAt: new Date().toISOString() });
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(tmpPath, body);
    fs.renameSync(tmpPath, filePath);
    return true;
  } catch (error) {
    console.error(`herdr-web: could not write ${filePath}: ${error.message}`);
    try {
      fs.rmSync(tmpPath, { force: true });
    } catch {
      // best effort cleanup
    }
    return false;
  }
}

module.exports = { mobileViewerPath, parseDevice, writeMobileViewer };
