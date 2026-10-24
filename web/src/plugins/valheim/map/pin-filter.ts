/**
 * ROK-1943 D9/D10 — the Map pin filter's URL state: type chips (`pins`), whose
 * pins (`players`), label search (`q`) and hide crossed-out (`crossed`). Every
 * filter is shareable; the writers keep every other param (`vc`, `vm`, …).
 *
 * Back-compat (D10): `?pins=death&vc=7` (a Deaths bar) = Death, this character;
 * legacy `?pins=death` with no `vc` and no `players` (the old "Show all") =
 * Death, every player. The first write normalises a legacy URL to the explicit
 * `players=all` + `vc` form so the implied scope never flips under the user.
 */
import { CHARACTER_PARAM, MAP_PARAM } from './map-selection';
import {
    ALL_PLAYERS, CROSSED_PARAM, DEATH_PINS, HIDE_CROSSED, PINS_PARAM, PLAYERS_PARAM, QUERY_PARAM,
} from './pin-filter-params';
import { PIN_TYPE_GROUP_IDS, isPinTypeGroupId, type PinTypeGroupId } from './pin-type-groups';

export { DEATH_PINS, PINS_PARAM } from './pin-filter-params';
export { filterPins, matchesPinFilter, serverPinAsMapPin } from './pin-filter-pins';

/** Whose pins: the shown character's own map, every player, or chosen character ids. */
export type PinPlayers = 'character' | 'all' | readonly number[];

export interface PinFilter {
    /** Selected type groups; `null` = every type. */
    types: ReadonlySet<PinTypeGroupId> | null;
    players: PinPlayers;
    /** Trimmed, ≤64 chars; '' = no search. */
    query: string;
    hideCrossed: boolean;
}

/** Longest label a pin can carry — no point searching for more. */
export const PIN_QUERY_MAX = 64;
export const DEFAULT_PIN_FILTER: PinFilter = { types: null, players: 'character', query: '', hideCrossed: false };

function parseTypes(raw: string | null): ReadonlySet<PinTypeGroupId> | null {
    const ids = (raw ?? '').split(',').filter(isPinTypeGroupId);
    return ids.length === 0 ? null : new Set(ids);
}

function parsePlayerIds(raw: string): readonly number[] {
    const ids = raw.split(',').filter((t) => /^[1-9]\d{0,9}$/.test(t)).map(Number);
    return [...new Set(ids.filter((n) => n <= 2147483647))];
}

/** The old "Show all" link: `pins=death` alone, scope implied by the missing `vc`. */
function isLegacyShowAll(params: URLSearchParams): boolean {
    return params.get(PINS_PARAM) === DEATH_PINS && !params.has(CHARACTER_PARAM) && !params.has(PLAYERS_PARAM);
}

function parsePlayers(params: URLSearchParams): PinPlayers {
    if (isLegacyShowAll(params)) return 'all';
    const raw = params.get(PLAYERS_PARAM);
    if (raw === null) return 'character';
    if (raw === ALL_PLAYERS) return 'all';
    const ids = parsePlayerIds(raw);
    return ids.length === 0 ? 'character' : ids;
}

/** Reads the four filters; unknown chip ids and bad player ids are dropped (all bad → absent). */
export function parsePinFilter(params: URLSearchParams): PinFilter {
    return {
        types: parseTypes(params.get(PINS_PARAM)),
        players: parsePlayers(params),
        query: (params.get(QUERY_PARAM) ?? '').trim().slice(0, PIN_QUERY_MAX),
        hideCrossed: params.get(CROSSED_PARAM) === HIDE_CROSSED,
    };
}

function setOrDelete(params: URLSearchParams, key: string, value: string | null): void {
    if (value === null) params.delete(key);
    else params.set(key, value);
}

function serialiseTypes(types: ReadonlySet<PinTypeGroupId> | null): string | null {
    if (types === null || types.size === 0 || types.size === PIN_TYPE_GROUP_IDS.length) return null;
    return PIN_TYPE_GROUP_IDS.filter((id) => types.has(id)).join(',');
}

function serialisePlayers(players: PinPlayers): string | null {
    if (players === 'character') return null;
    if (players === 'all') return ALL_PLAYERS;
    return players.length === 0 ? null : [...new Set(players)].join(',');
}

/** Writes `filter` over `params`, pinning the shown character in `vc` (D10 normalisation). */
function writeFull(params: URLSearchParams, filter: PinFilter, characterId: number): URLSearchParams {
    const next = new URLSearchParams(params);
    setOrDelete(next, PINS_PARAM, serialiseTypes(filter.types));
    setOrDelete(next, PLAYERS_PARAM, serialisePlayers(filter.players));
    const query = filter.query.trim().slice(0, PIN_QUERY_MAX);
    setOrDelete(next, QUERY_PARAM, query === '' ? null : query);
    setOrDelete(next, CROSSED_PARAM, filter.hideCrossed ? HIDE_CROSSED : null);
    if (!next.has(CHARACTER_PARAM)) next.set(CHARACTER_PARAM, String(characterId));
    return next;
}

/**
 * One control's write: `patch` over the current filter. Never replaces a `vc`
 * already in the URL; adds the shown character's when absent, and a legacy
 * "Show all" URL keeps its every-player scope as an explicit `players=all`.
 */
export function writePinFilter(
    params: URLSearchParams,
    patch: Partial<PinFilter>,
    characterId: number,
): URLSearchParams {
    return writeFull(params, { ...parsePinFilter(params), ...patch }, characterId);
}

/** "Clear all" (D13): the four filters back to default; `vc`/`vm` and other params kept. */
export function clearPinFilters(params: URLSearchParams, characterId: number): URLSearchParams {
    return writeFull(params, DEFAULT_PIN_FILTER, characterId);
}

/** Toggles one chip; from "every type" it selects just that one, the last one off → every type. */
export function toggleType(
    types: ReadonlySet<PinTypeGroupId> | null,
    id: PinTypeGroupId,
): ReadonlySet<PinTypeGroupId> | null {
    const next = new Set(types ?? []);
    if (types !== null && next.has(id)) next.delete(id);
    else next.add(id);
    return next.size === 0 || next.size === PIN_TYPE_GROUP_IDS.length ? null : next;
}

/** The funnel badge: how many of the four sections differ from default (0..4). */
export function activeFilterCount(filter: PinFilter): number {
    return [
        filter.types !== null,
        filter.players !== 'character',
        filter.query !== '',
        filter.hideCrossed,
    ].filter(Boolean).length;
}

/**
 * The Map tab's picker write. Q1 = (a): a character (or world) pick keeps the
 * players choice — only `vc`/`vm` change, so only the base map and fog switch.
 * A legacy "Show all" URL is normalised first so the new `vc` cannot end it.
 */
export function writeSelection(
    params: URLSearchParams,
    pick: { characterId: number; mapId: number | null; world: boolean },
): URLSearchParams {
    const next = new URLSearchParams(params);
    if (isLegacyShowAll(params)) next.set(PLAYERS_PARAM, ALL_PLAYERS);
    next.set(CHARACTER_PARAM, String(pick.characterId));
    setOrDelete(next, MAP_PARAM, pick.mapId === null ? null : String(pick.mapId));
    return next;
}
