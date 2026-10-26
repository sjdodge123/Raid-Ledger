/**
 * ROK-1930 — pure helpers for the hub Deaths widget: the Map-tab deep links
 * (D13: no SteamID anywhere — a bar opens `?pins=death&vc=<characterId>#map`),
 * the meter scale and the row cap (Q5: top 8).
 */
import type { ValheimDeathPicture, ValheimDeathPlayer } from '@raid-ledger/contract';
import { syncedAgo } from '../../../lib/synced-ago';
import { CHARACTER_PARAM } from '../map/map-selection';
import { DEATHS_SHOW_ALL_HREF, DEATH_PINS, PINS_PARAM } from '../map/pin-filter-params';

/** The Map tab's pin-type filter param (shared with `map/pin-filter.ts`). */
export const DEATH_PINS_PARAM = PINS_PARAM;
export const DEATH_PINS_VALUE = DEATH_PINS;
/** Q5: the widget shows at most this many bars. */
export const MAX_DEATH_ROWS = 8;

/** "Show all": the server-wide death layer on the Map tab. */
export function deathsShowAllHref(): string {
    return DEATHS_SHOW_ALL_HREF;
}

/** One bar's Map-tab link, or null when the bar has no character to open. */
export function deathsMapHref(player: Pick<ValheimDeathPlayer, 'characterId'>): string | null {
    if (player.characterId === null) return null;
    const params = new URLSearchParams({
        [DEATH_PINS_PARAM]: DEATH_PINS_VALUE,
        [CHARACTER_PARAM]: String(player.characterId),
    });
    return `?${params.toString()}#map`;
}

/** A bar's fill, scaled so the top player is 100%; 0 when nothing to scale against. */
export function meterPct(deaths: number, maxDeaths: number): number {
    if (maxDeaths <= 0 || deaths <= 0) return 0;
    return Math.min(100, (deaths / maxDeaths) * 100);
}

/** The rows the card draws, in the order the API serves them. */
export function visibleRows(players: readonly ValheimDeathPlayer[]): readonly ValheimDeathPlayer[] {
    return players.slice(0, MAX_DEATH_ROWS);
}

/** "Counted since 23 Oct 2026" in the viewer's timezone; null when no death is recorded. */
export function countedSinceLine(since: string | null, timeZone: string): string | null {
    if (since === null) return null;
    const date = new Date(since).toLocaleDateString(undefined, {
        day: 'numeric', month: 'short', year: 'numeric', timeZone,
    });
    return `Counted since ${date}`;
}

/** A thumb's accessible name, the Gallery tile's wording ("Death — Jasz, 1 day ago. Open picture"). */
export function deathThumbLabel(name: string, picture: ValheimDeathPicture, now: number = Date.now()): string {
    return `Death — ${name}, ${syncedAgo(picture.capturedAt, now)}. Open picture`;
}

/** "+N"'s accessible name. */
export function morePicturesLabel(extra: number): string {
    return `${extra} more death ${extra === 1 ? 'picture' : 'pictures'}. Open the gallery`;
}
