import { withEnv } from './envs';
import { appUrl } from './base';
/** Mime types the server accepts and agents can read. */
export const SUPPORTED_IMAGE_MIME_TYPES: readonly string[] = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

// Apple photo formats. Browsers usually transcode these when a photo is picked through a
// file input, but a direct share or paste can still hand over the original.
const UNCONVERTIBLE_IMAGE_MIME_TYPES: readonly string[] = [
    'image/heic',
    'image/heif',
    'image/heic-sequence',
    'image/heif-sequence',
];

/** Kept in step with `ImageStore.MAX_BYTES` on the server. */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

const UPLOAD_ENDPOINT = appUrl('images');

const normalizeType = (type: string): string => type.split(';')[0].trim().toLowerCase();

export function isSupportedImageType(type: string): boolean {
    return SUPPORTED_IMAGE_MIME_TYPES.includes(normalizeType(type));
}

export function isUnconvertibleImageType(type: string): boolean {
    return UNCONVERTIBLE_IMAGE_MIME_TYPES.includes(normalizeType(type));
}

/**
 * Pulls image files out of a paste or a drop. `DataTransfer.files` comes back empty for a
 * clipboard image on some mobile browsers, where the bitmap only appears under `items`,
 * so both are read.
 */
export function imageFilesFromDataTransfer(dataTransfer: DataTransfer | null | undefined): File[] {
    if (!dataTransfer) {
        return [];
    }

    const collected: File[] = [...(dataTransfer.files ?? [])];
    for (const item of dataTransfer.items ?? []) {
        if (item.kind !== 'file') {
            continue;
        }
        const file = item.getAsFile();
        if (file && !collected.some((existing) => existing === file || existing.name === file.name)) {
            collected.push(file);
        }
    }
    return collected.filter((file) => file.type.startsWith('image/'));
}

/** Returns the reason to show the user, or null when the file is fine to upload. */
export function validateImageFile(file: File): string | null {
    if (file.size === 0) {
        return `"${file.name || 'image'}" is empty`;
    }
    if (isUnconvertibleImageType(file.type)) {
        return 'HEIC/HEIF is not supported — save the photo as JPEG or PNG first';
    }
    if (!isSupportedImageType(file.type)) {
        return `Unsupported image type "${file.type || 'unknown'}" — use PNG, JPEG, WebP or GIF`;
    }
    if (file.size > MAX_IMAGE_BYTES) {
        return `Images must be ${Math.round(MAX_IMAGE_BYTES / (1024 * 1024))} MB or smaller`;
    }
    return null;
}

/**
 * Quotes a path for the shell: single quotes, with any embedded quote closed, escaped
 * and reopened, so a path with spaces stays one argument.
 */
export function quoteShellPath(filePath: string): string {
    return `'${filePath.replace(/'/g, `'\\''`)}'`;
}

/** Uploads one image and resolves to the absolute path the server saved it at. */
export async function uploadImage(file: File, envId = 'default'): Promise<string> {
    const response = await fetch(withEnv(UPLOAD_ENDPOINT, envId), {
        method: 'POST',
        headers: { 'Content-Type': file.type },
        body: file,
    });

    const payload = (await response.json().catch(() => null)) as { path?: string; message?: string } | null;
    if (!response.ok || !payload?.path) {
        throw new Error(payload?.message || `Upload failed (${response.status})`);
    }
    return payload.path;
}
