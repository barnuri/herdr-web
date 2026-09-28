'use strict';

const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);

const HERDR_MAX_BUFFER_BYTES = 8 * 1024 * 1024;

const HERDR_EXEC_TIMEOUT_MS = 15000;

function herdrBinaryPath() {
  return process.env.HERDR_BIN_PATH || 'herdr';
}


async function execHerdr(args) {
  try {
    const { stdout } = await execFileAsync(herdrBinaryPath(), args, {
      encoding: 'utf8',
      maxBuffer: HERDR_MAX_BUFFER_BYTES,
      timeout: HERDR_EXEC_TIMEOUT_MS,
      killSignal: 'SIGKILL',
    });
    return stdout;
  } catch (error) {
    const stderr = typeof error.stderr === 'string' ? error.stderr.trim() : '';
    throw new Error(`herdr ${args.join(' ')} failed: ${stderr || error.message}`);
  }
}

async function runHerdr(args) {
  const stdout = await execHerdr(args);
  let envelope;
  try {
    envelope = JSON.parse(stdout);
  } catch {
    throw new Error(`herdr ${args.join(' ')} returned unparseable output: ${stdout.trim()}`);
  }
  return envelope.result;
}

async function runHerdrText(args) {
  return execHerdr(args);
}

async function listWorkspaces() {
  return (await runHerdr(['workspace', 'list'])).workspaces || [];
}

async function listTabs() {
  return (await runHerdr(['tab', 'list'])).tabs || [];
}

async function listPanes() {
  return (await runHerdr(['pane', 'list'])).panes || [];
}




async function notifyDesktop(title, body) {
  try {
    await runHerdrText(['notification', 'show', title, '--body', body]);
  } catch (error) {
    // Notifications are best-effort; never let a failed toast break the caller.
    console.error(`herdr notification failed: ${error.message}`);
  }
}

module.exports = {
  runHerdr,
  runHerdrText,
  listWorkspaces,
  listTabs,
  listPanes,
  notifyDesktop,
};
