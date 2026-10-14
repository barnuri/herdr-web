'use strict';

const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);

class SystemClipboard {
    static MAX_BYTES = 1024 * 1024;

    static TIMEOUT_MS = 2000;

    /**
     * herdr copies a mouse selection with pbcopy on the machine it runs on, never over OSC 52,
     * so the browser can only get that text by reading the same clipboard. Returns null where
     * there is no pbpaste (not macOS) or the read fails.
     */
    static async read() {
        if (process.platform !== 'darwin') {
            return null;
        }
        try {
            const { stdout } = await execFileAsync('pbpaste', [], {
                encoding: 'utf8',
                maxBuffer: SystemClipboard.MAX_BYTES,
                timeout: SystemClipboard.TIMEOUT_MS,
            });
            return stdout === '' ? null : stdout;
        } catch {
            return null;
        }
    }
}

module.exports = { SystemClipboard };
