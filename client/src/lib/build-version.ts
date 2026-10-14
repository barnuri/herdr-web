const ENTRY_SCRIPT_PATTERN = /\/assets\/index-[\w-]+\.js/;

export function entryScriptIn(html: string): string | null {
    return ENTRY_SCRIPT_PATTERN.exec(html)?.[0] ?? null;
}

export function isNewerBuild(runningScript: string | null, servedScript: string | null): boolean {
    return runningScript !== null && servedScript !== null && runningScript !== servedScript;
}

export async function isRunningBuildStale(): Promise<boolean> {
    const running = document.querySelector('script[src*="/assets/index-"]')?.getAttribute('src') ?? null;
    try {
        const response = await fetch('/', { cache: 'no-store' });
        return isNewerBuild(running === null ? null : entryScriptIn(running), entryScriptIn(await response.text()));
    } catch {
        return false;
    }
}
