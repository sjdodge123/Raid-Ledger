/**
 * ROK-1814 — pure helpers behind `HubCrest`: initials, the API-prefixed crest
 * URL, and the narrowing of a crest payload that may carry a source this
 * client does not know yet (ROK-1170 adds `blizzard`).
 */
import {
    GUILD_CREST_EMBLEM_IDS, GUILD_CREST_PALETTE_IDS,
    type GuildCrest, type GuildCrestEmblemId, type GuildCrestPaletteId,
} from '@raid-ledger/contract';
import { API_BASE_URL } from '../../../lib/config';

/** What a hub DTO may hand us: a known crest, a future source, or nothing. */
export type HubCrestInput = GuildCrest | { readonly source: string } | null | undefined;

export interface CrestUpload { urlSm: string; urlLg: string }
export interface CrestPreset { emblemId: GuildCrestEmblemId; fg: GuildCrestPaletteId; bg: GuildCrestPaletteId }

/** Up to two initials for the crest fallback ("Iron Vanguard" → "IV"). */
export function crestInitials(name: string): string {
    const letters = name.split(/\s+/).filter(Boolean).map((w) => w.charAt(0).toUpperCase());
    return letters.slice(0, 2).join('') || '?';
}

/** Crest files are api-relative (`/uploads/guild-crests/…`); prefix the API base like avatars. */
export function crestAssetUrl(url: string): string {
    return /^https?:\/\//i.test(url) ? url : `${API_BASE_URL}${url}`;
}

function stringField(obj: object, key: string): string | null {
    const value: unknown = Reflect.get(obj, key);
    return typeof value === 'string' && value.length > 0 ? value : null;
}

function isOneOf<T extends string>(list: readonly T[], value: string | null): value is T {
    return value !== null && list.some((v) => v === value);
}

/** The upload URLs when `crest` is a well-formed upload, else null. */
export function asCrestUpload(crest: HubCrestInput): CrestUpload | null {
    if (!crest || crest.source !== 'upload') return null;
    const urlSm = stringField(crest, 'urlSm');
    const urlLg = stringField(crest, 'urlLg');
    return urlSm && urlLg ? { urlSm, urlLg } : null;
}

/** The preset fields when `crest` is a well-formed preset, else null. */
export function asCrestPreset(crest: HubCrestInput): CrestPreset | null {
    if (!crest || crest.source !== 'preset') return null;
    const emblemId = stringField(crest, 'emblemId');
    const fg = stringField(crest, 'fg');
    const bg = stringField(crest, 'bg');
    if (!isOneOf(GUILD_CREST_EMBLEM_IDS, emblemId)) return null;
    if (!isOneOf(GUILD_CREST_PALETTE_IDS, fg) || !isOneOf(GUILD_CREST_PALETTE_IDS, bg)) return null;
    return { emblemId, fg, bg };
}
