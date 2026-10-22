/** Whether the server's `/meta` reply turns client-side BiDi on; anything but `false` means on. */
export function clientBidiFromMeta(meta: unknown): boolean {
    if (typeof meta !== 'object' || meta === null) {
        return true;
    }
    return (meta as { clientBidi?: unknown }).clientBidi !== false;
}
