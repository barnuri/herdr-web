'use strict';

const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const { childEnvFor } = require('./envs');

const execFileAsync = promisify(execFile);

const HERDR_MAX_BUFFER_BYTES = 8 * 1024 * 1024;

const HERDR_EXEC_TIMEOUT_MS = 15000;

function herdrBinaryPath() {
  return process.env.HERDR_BIN_PATH || 'herdr';
}


async function execHerdr(args, envInfo) {
  try {
    const { stdout } = await execFileAsync(herdrBinaryPath(), args, {
      encoding: 'utf8',
      maxBuffer: HERDR_MAX_BUFFER_BYTES,
      timeout: HERDR_EXEC_TIMEOUT_MS,
      killSignal: 'SIGKILL',
      env: childEnvFor(envInfo),
    });
    return stdout;
  } catch (error) {
    const stderr = typeof error.stderr === 'string' ? error.stderr.trim() : '';
    throw new Error(`herdr ${args.join(' ')} failed: ${stderr || error.message}`);
  }
}

async function runHerdr(args, envInfo) {
  const stdout = await execHerdr(args, envInfo);
  let envelope;
  try {
    envelope = JSON.parse(stdout);
  } catch {
    throw new Error(`herdr ${args.join(' ')} returned unparseable output: ${stdout.trim()}`);
  }
  return envelope.result;
}

async function runHerdrText(args, envInfo) {
  return execHerdr(args, envInfo);
}

async function listWorkspaces(envInfo) {
  return (await runHerdr(['workspace', 'list'], envInfo)).workspaces || [];
}

async function listTabs(envInfo) {
  return (await runHerdr(['tab', 'list'], envInfo)).tabs || [];
}

async function listPanes(envInfo) {
  return (await runHerdr(['pane', 'list'], envInfo)).panes || [];
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
