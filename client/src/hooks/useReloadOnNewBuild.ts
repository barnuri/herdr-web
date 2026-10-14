import { useEffect } from 'react';
import { isRunningBuildStale } from '../lib/build-version';

export function useReloadOnNewBuild(connected: boolean): void {
    useEffect(() => {
        if (!connected) {
            return;
        }
        const reloadIfStale = async () => {
            if (await isRunningBuildStale()) {
                window.location.reload();
            }
        };
        const onVisibilityChange = () => {
            if (document.visibilityState === 'visible') {
                void reloadIfStale();
            }
        };
        void reloadIfStale();
        document.addEventListener('visibilitychange', onVisibilityChange);
        return () => document.removeEventListener('visibilitychange', onVisibilityChange);
    }, [connected]);
}
