/**
 * Screenshot + page context for the feedback widget (ROK-1313). Pure helpers:
 * the dialog validates a picked/pasted file, reads it once into the base64 the
 * API takes (no `data:` prefix — the server sniffs the bytes, never a header)
 * plus the raw bytes for the Sentry attachment, and an object URL for the
 * preview. The caller owns that URL and revokes it.
 */
import { FEEDBACK_SCREENSHOT_MAX_BYTES, type FeedbackClientContext } from '@raid-ledger/contract';

export type ScreenshotMime = 'image/png' | 'image/jpeg';

export interface FeedbackScreenshot {
    /** Base64 of the file, `data:…;base64,` prefix stripped. */
    base64: string;
    bytes: Uint8Array;
    mime: ScreenshotMime;
    previewUrl: string;
    name: string;
}

export const SCREENSHOT_ERROR = 'Screenshots must be PNG or JPEG, up to 3.5 MB.';

const USER_AGENT_MAX = 1000;
const APP_VERSION_MAX = 100;

function isScreenshotMime(type: string): type is ScreenshotMime {
    return type === 'image/png' || type === 'image/jpeg';
}

/** The inline error for a file we won't send, or null when it is fine. */
export function validateScreenshotFile(file: File): string | null {
    if (!isScreenshotMime(file.type) || file.size > FEEDBACK_SCREENSHOT_MAX_BYTES) return SCREENSHOT_ERROR;
    return null;
}

/** `data:image/png;base64,AAAA` → `AAAA`. */
export function stripDataUrlPrefix(dataUrl: string): string {
    const comma = dataUrl.indexOf(',');
    return comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
}

function readDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
        reader.onerror = () => reject(reader.error ?? new Error('Could not read the screenshot'));
        reader.readAsDataURL(file);
    });
}

function base64ToBytes(base64: string): Uint8Array {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

/** Read a validated PNG/JPEG into everything the submit + preview need. */
export async function readScreenshot(file: File): Promise<FeedbackScreenshot> {
    if (!isScreenshotMime(file.type)) throw new Error(SCREENSHOT_ERROR);
    const base64 = stripDataUrlPrefix(await readDataUrl(file));
    return {
        base64,
        bytes: base64ToBytes(base64),
        mime: file.type,
        previewUrl: URL.createObjectURL(file),
        name: file.name,
    };
}

/** The Sentry attachment's filename — the extension the server would store. */
export function screenshotFilename(shot: Pick<FeedbackScreenshot, 'mime'>): string {
    return shot.mime === 'image/png' ? 'screenshot.png' : 'screenshot.jpg';
}

function appVersion(): string {
    // `__APP_VERSION__` is a Vite `define`; vitest and odd builds don't set it.
    const raw: unknown = typeof __APP_VERSION__ === 'undefined' ? undefined : __APP_VERSION__;
    return typeof raw === 'string' && raw !== '' ? raw.slice(0, APP_VERSION_MAX) : 'unknown';
}

/** Where the report came from: viewport, browser and app version. */
export function buildClientContext(): FeedbackClientContext {
    return {
        viewport: { w: Math.max(0, Math.round(window.innerWidth)), h: Math.max(0, Math.round(window.innerHeight)) },
        userAgent: navigator.userAgent.slice(0, USER_AGENT_MAX),
        appVersion: appVersion(),
    };
}
