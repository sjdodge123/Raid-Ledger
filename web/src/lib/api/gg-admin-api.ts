/**
 * Admin "GG <year>" client (ROK-2187): delivery settings, dry run, recompute,
 * send-now (`gg-admin.controller.ts`) and the community mascot picker
 * (`gg-mascot.controller.ts`). All routes are AdminGuard'ed.
 */
import type {
    GgAdminDryRunDto, GgAdminRecomputeDto, GgAdminSettingsDto, GgAdminSettingsUpdateDto,
    GgMascot, GgMascotOptionsDto, GgMascotSelectDto,
} from '@raid-ledger/contract';
import { fetchApi, fetchWithAuth } from './fetch-api';
import { encodePathSegment } from './path-segment';

/** Current GG delivery settings. */
export function getGgAdminSettings(): Promise<GgAdminSettingsDto> {
    return fetchApi('/admin/gg/settings');
}

/** Patch any subset of the delivery settings. */
export function updateGgAdminSettings(body: GgAdminSettingsUpdateDto): Promise<GgAdminSettingsDto> {
    return fetchApi('/admin/gg/settings', { method: 'PATCH', body: JSON.stringify(body) });
}

/** What a compute + DM wave for `year` would do. */
export function getGgDryRun(year: number): Promise<GgAdminDryRunDto> {
    return fetchApi(`/admin/gg/dry-run?year=${year}`);
}

/** Recompute every snapshot for a year (refused after announce unless `force`). */
export function recomputeGg(body: GgAdminRecomputeDto): Promise<unknown> {
    return fetchApi('/admin/gg/recompute', { method: 'POST', body: JSON.stringify(body) });
}

/** Send now — bypasses the date gate, still idempotent. */
export function sendGgNow(): Promise<unknown> {
    return fetchApi('/admin/gg/send-now', { method: 'POST' });
}

/** The saved mascot (`null` = none). */
export function getGgMascot(): Promise<GgMascot | null> {
    return fetchApi('/admin/gg/mascot');
}

/** The guild's emojis + soundboard sounds (503 while the bot is offline). */
export function getGgMascotOptions(): Promise<GgMascotOptionsDto> {
    return fetchApi('/admin/gg/mascot/options');
}

/** Save (copies the assets), re-sync (save again) or remove (`emojiId: null`). */
export function selectGgMascot(body: GgMascotSelectDto): Promise<GgMascot | null> {
    return fetchApi('/admin/gg/mascot', { method: 'PATCH', body: JSON.stringify(body) });
}

/**
 * A playable object URL for a soundboard sound's ▶ preview. The stream is
 * admin-only (bearer token) and CSP has no `media-src` for Discord's CDN, so
 * the bytes come through the API and play from a same-origin blob. The
 * caller revokes the URL once played.
 */
export async function fetchGgSoundPreviewUrl(soundId: string): Promise<string> {
    const res = await fetchWithAuth(`/admin/gg/mascot/sounds/${encodePathSegment(soundId)}/preview`);
    if (!res.ok) throw new Error(`Sound preview failed (${res.status})`);
    return URL.createObjectURL(await res.blob());
}
