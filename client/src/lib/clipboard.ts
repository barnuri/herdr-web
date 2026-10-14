/**
 * herdr copies a selection by writing OSC 52 (`<targets>;<base64>`) to the terminal. Returns the
 * decoded text, or null for a clipboard read request (`?`), an empty payload, or bad base64.
 */
export function parseOsc52(data: string): string | null {
    const separator = data.indexOf(';');
    if (separator === -1) {
        return null;
    }
    const payload = data.slice(separator + 1);
    if (payload === '' || payload === '?') {
        return null;
    }
    try {
        const bytes = Uint8Array.from(atob(payload), (char) => char.charCodeAt(0));
        const text = new TextDecoder().decode(bytes);
        return text === '' ? null : text;
    } catch {
        return null;
    }
}

function copyWithSelection(text: string): boolean {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none;';
    document.body.appendChild(area);
    try {
        area.select();
        area.setSelectionRange(0, text.length);
        return document.execCommand('copy');
    } catch {
        return false;
    } finally {
        area.remove();
        previouslyFocused?.focus();
    }
}

/**
 * Plain http has no `navigator.clipboard`, so fall back to `execCommand('copy')`. Browsers only
 * allow that during a user gesture, so a copy that arrives from the socket may return false —
 * the caller then asks for a tap and calls this again from the tap handler.
 */
export async function copyText(text: string): Promise<boolean> {
    if (window.isSecureContext && navigator.clipboard) {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch {
            /* denied without a gesture — try the selection route */
        }
    }
    return copyWithSelection(text);
}
