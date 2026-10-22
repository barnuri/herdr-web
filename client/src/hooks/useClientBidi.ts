import { useEffect, useState } from 'react';
import { clientBidiFromMeta } from '../lib/client-bidi';

// starts off: when herdr reorders rows itself, drawing them reversed even once is wrong
export function useClientBidi(): boolean {
    const [enabled, setEnabled] = useState(false);
    useEffect(() => {
        let active = true;
        const load = async () => {
            let meta: unknown = null;
            try {
                meta = await (await fetch('/meta')).json();
            } catch (error) {
                console.warn('herdr-web: /meta is unreachable, client BiDi stays on by default', error);
            }
            if (active) {
                setEnabled(clientBidiFromMeta(meta));
            }
        };
        void load();
        return () => {
            active = false;
        };
    }, []);
    return enabled;
}
