/**
 * ROK-2352 §3.6 — pure state for the WoW LFG hub picker. The URL `?hub=` is
 * the source of truth; the last pick is remembered per viewer browser in
 * `localStorage` (`rl.lfg.lastHub.wow`), wrapped in try/catch because storage
 * can be blocked (Safari private mode). No server state, no global store.
 */
import type { GameRegistryDto, MyGuild } from '@raid-ledger/contract';
import { WOW_SLUGS } from '../utils';

/** `rl.lfg.lastHub.<gameFamily>` — every WoW variant shares one family. */
export const LAST_HUB_STORAGE_KEY = 'rl.lfg.lastHub.wow';

/** One picker option: a viewer hub on a WoW game, with its game slug resolved. */
export interface WowHubOption {
    hubId: number;
    hubName: string;
    gameSlug: string;
    /** "<hub> · <variant>" (§3.6). */
    label: string;
}

/** The registry's display name for a slug, or null when the slug is unknown. */
export function variantName(slug: string, registry: readonly GameRegistryDto[]): string | null {
    const game = registry.find((g) => g.slug === slug);
    return game ? (game.shortName ?? game.name) : null;
}

/**
 * A hub's game slug: `gameSlug` when sent, else `gameId` → the game registry.
 * `GET /guilds/mine` builds summaries from the bare row (`toGuildSummary`), so
 * the fallback is the normal path there, not an edge case.
 */
export function hubGameSlug(hub: MyGuild, registry: readonly GameRegistryDto[]): string | null {
    if (hub.gameSlug) return hub.gameSlug;
    return registry.find((g) => g.id === hub.gameId)?.slug ?? null;
}

/** The viewer's hubs whose game is one of the WoW slugs, as picker options. */
export function wowHubOptions(
    hubs: readonly MyGuild[],
    registry: readonly GameRegistryDto[],
): WowHubOption[] {
    const out: WowHubOption[] = [];
    for (const hub of hubs) {
        const slug = hubGameSlug(hub, registry);
        if (slug === null || !WOW_SLUGS.has(slug)) continue;
        const variant = variantName(slug, registry) ?? slug;
        out.push({ hubId: hub.id, hubName: hub.name, gameSlug: slug, label: `${hub.name} · ${variant}` });
    }
    return out;
}

/** The option `?hub` names, only when that hub's game is the page's game (else ignored). */
export function matchHub(
    hubId: number | null,
    options: readonly WowHubOption[],
    pageSlug: string,
): WowHubOption | null {
    if (hubId === null) return null;
    const hit = options.find((o) => o.hubId === hubId);
    return hit && hit.gameSlug === pageSlug ? hit : null;
}

/** The remembered hub id, or null (missing, malformed or storage blocked). */
export function readLastHub(): number | null {
    try {
        const raw = window.localStorage.getItem(LAST_HUB_STORAGE_KEY);
        if (raw === null || !/^\d+$/.test(raw)) return null;
        const id = Number(raw);
        return id > 0 ? id : null;
    } catch {
        return null;
    }
}

/** Remember (or with null, forget) the last pick; a blocked storage is a no-op. */
export function writeLastHub(hubId: number | null): void {
    try {
        if (hubId === null) window.localStorage.removeItem(LAST_HUB_STORAGE_KEY);
        else window.localStorage.setItem(LAST_HUB_STORAGE_KEY, String(hubId));
    } catch {
        // Storage blocked — the URL still carries the pick.
    }
}
