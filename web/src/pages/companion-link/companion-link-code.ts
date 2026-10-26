/**
 * ROK-1955 — pure helpers for the `/link` page: the typed code's display
 * form, the code a deep link pre-fills, and minute arithmetic for the
 * "requested / expires" line.
 */
import type { CompanionDeviceOs, CompanionLinkPreview } from '@raid-ledger/contract';

/** Typed input → `XXXX-XXXX` display form (letters only, max 8, dash after 4). */
export function formatUserCodeInput(raw: string): string {
    const letters = raw.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 8);
    return letters.length > 4 ? `${letters.slice(0, 4)}-${letters.slice(4)}` : letters;
}

/** The `code` value from a `#a=b&…` fragment or `?a=b` query string. */
function codeParam(raw: string): string | null {
    const value = new URLSearchParams(raw.replace(/^[#?]/, '')).get('code');
    return value ? formatUserCodeInput(value) : null;
}

/**
 * The code a deep link carries. The fragment (`/link#code=…`) is preferred —
 * it never reaches access logs or a Referer, and the API's RFC 8628
 * `verificationUriComplete` uses it. A legacy `?code=` link is still read.
 */
export function readPrefilledCode(hash: string, search: string): string | null {
    return codeParam(hash) ?? codeParam(search);
}

/** Whole minutes from `nowMs` to `iso` (negative = in the past). */
export function relativeMinutes(iso: string, nowMs: number): number {
    return Math.round((Date.parse(iso) - nowMs) / 60_000);
}

const OS_LABEL: Record<CompanionDeviceOs, string> = { windows: 'Windows', macos: 'macOS', linux: 'Linux', other: 'Other' };

/** "Windows 11 · Companion 0.1.0". */
export function systemLine(device: CompanionLinkPreview['device']): string {
    const os = device.osVersion ? `${OS_LABEL[device.os]} ${device.osVersion}` : OS_LABEL[device.os];
    return `${os} · Companion ${device.appVersion}`;
}

/** The expiry half of the timing line; past `expiresAt` it matches the review card's soft hint. */
function expiryPhrase(expiresAt: string, nowMs: number): string {
    if (Date.parse(expiresAt) <= nowMs) return 'may have expired';
    const left = relativeMinutes(expiresAt, nowMs);
    return left < 1 ? 'expires in under a minute' : `expires in ${left} min`;
}

/** "2 min ago · expires in 8 min" (or "… · may have expired" once past `expiresAt`). */
export function timingLine(preview: CompanionLinkPreview, nowMs: number): string {
    const ago = -relativeMinutes(preview.requestedAt, nowMs);
    const requested = ago < 1 ? 'Just now' : `${ago} min ago`;
    return `${requested} · ${expiryPhrase(preview.expiresAt, nowMs)}`;
}
