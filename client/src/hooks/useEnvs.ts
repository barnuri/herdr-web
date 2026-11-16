import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_ENV_ID, ENV_POLL_MS, fetchEnvs, persistEnv, resolveSelection, wantedEnvId } from '../lib/envs';
import type { HerdrEnv } from '../lib/envs';

export interface EnvsState {
    /** false until the first /api/envs answer, so no socket opens against an unvalidated id */
    readonly ready: boolean;
    readonly envs: HerdrEnv[];
    readonly envId: string;
    readonly notice: string | null;
    readonly select: (id: string) => void;
}

export function useEnvs(): EnvsState {
    const [ready, setReady] = useState(false);
    const [envs, setEnvs] = useState<HerdrEnv[]>([]);
    const [envId, setEnvId] = useState(() => wantedEnvId(window.location.search, localStorage));
    const [notice, setNotice] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            const list = await fetchEnvs();
            if (cancelled) {
                return;
            }
            // a failed fetch keeps the last list; the first failure falls back to the default env
            const next = list ?? [];
            setEnvs(next);
            setEnvId((current) => {
                const selection = resolveSelection(next, current);
                if (selection.fellBackFrom !== null) {
                    setNotice(`Environment "${selection.fellBackFrom}" is no longer available — switched to the default.`);
                    persistEnv(DEFAULT_ENV_ID, localStorage, window.history, window.location);
                }
                return selection.id;
            });
            setReady(true);
        };
        void load();
        const timer = setInterval(() => void load(), ENV_POLL_MS);
        return () => {
            cancelled = true;
            clearInterval(timer);
        };
    }, []);

    const select = useCallback((id: string) => {
        setNotice(null);
        persistEnv(id, localStorage, window.history, window.location);
        setEnvId(id);
    }, []);

    return { ready, envs, envId, notice, select };
}
