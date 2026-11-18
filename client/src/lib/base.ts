// The client is served under /tui/ (vite `base`), so every absolute URL goes through here.
export const BASE = import.meta.env.BASE_URL;

export function appUrl(path: string): string {
    return BASE + path.replace(/^\/+/, '');
}
