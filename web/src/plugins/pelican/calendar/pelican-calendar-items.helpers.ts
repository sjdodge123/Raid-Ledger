/**
 * Pure mapping from the `/game-servers/*` contract to generic calendar layer
 * items (ROK-1774 L3). The host draws one neutral look; this file only picks
 * the items to show and pre-formats every string in the viewer's timezone.
 * Kept dependency-free (Intl only): it loads in the entry chunk via register.ts.
 */
import type {
    GameServerCalendarItemDto,
    GameServerEffect,
    GameServerMarkerItemDto,
    GameServerState,
    GameServerStatusDto,
    GameServerWindowItemDto,
} from '@raid-ledger/contract';
import type { CalendarLayerItem, CalendarLayerMarker, CalendarLayerWindow } from '../../calendar-layer';

/** Spec Q6: wireframe copy; `mixed` reads "Scheduled task". */
export const EFFECT_LABELS: Record<GameServerEffect, string> = {
    restart: 'Restart',
    stop: 'Stop',
    start: 'Start',
    kill: 'Kill',
    backup: 'Backup',
    command: 'Command',
    mixed: 'Scheduled task',
};

/** Spec Q6: "Online" for running (wireframe), not the admin chip's "Running". */
export const STATE_LABELS: Record<GameServerState, string> = {
    running: 'Online',
    starting: 'Starting',
    stopping: 'Stopping',
    offline: 'Offline',
    unknown: 'Unknown',
};

export const NOT_CHECKED_LINE = 'Status not checked yet';

type ServerRef = Pick<GameServerStatusDto, 'provider' | 'serverKey'>;

/** Join key for item ↔ status: the same server from the same provider. */
export function serverJoinKey(ref: ServerRef): string {
    return `${ref.provider}\u0000${ref.serverKey}`;
}

/** "4:05 AM" in `tz`; ICU's narrow no-break space is normalised to a plain space. */
export function formatLocalTime(iso: string, tz: string): string {
    const text = new Intl.DateTimeFormat('en-US', {
        hour: 'numeric', minute: '2-digit', timeZone: tz,
    }).format(new Date(iso));
    return text.replace(/[\u202f\u00a0]/g, ' ');
}

/** "Online · checked 2 min ago"; under a minute → "just now"; no row → "Status not checked yet". */
export function liveLine(status: GameServerStatusDto | undefined, now: number): string {
    if (!status) return NOT_CHECKED_LINE;
    const state = STATE_LABELS[status.state];
    const minutes = Math.floor((now - Date.parse(status.checkedAt)) / 60_000);
    const age = minutes < 1 ? 'just now' : `${minutes} min ago`;
    return `${state} · checked ${age}`;
}

export function windowLabel(serverName: string): string {
    return `Server up · ${serverName}`;
}

/** "Restart · Valheim Dedicated · 4:05 AM". */
export function markerTitle(item: GameServerMarkerItemDto, tz: string): string {
    return `${EFFECT_LABELS[item.effect]} · ${item.serverName} · ${formatLocalTime(item.at, tz)}`;
}

/**
 * The `shouldRenderInCalendar` rule for id-keyed items: no filter → show;
 * filter active → show only when the game's slug is selected. A game missing
 * from the registry has no slug to match, so it is hidden while a filter is
 * active (spec Q5).
 */
export function isServerItemVisible(
    gameId: number,
    slugById: ReadonlyMap<number, string>,
    selectedGames: ReadonlySet<string> | undefined,
): boolean {
    if (selectedGames === undefined) return true;
    const slug = slugById.get(gameId);
    return slug !== undefined && selectedGames.has(slug);
}

function toWindow(item: GameServerWindowItemDto, tz: string): CalendarLayerWindow {
    const label = windowLabel(item.serverName);
    return {
        kind: 'window',
        id: `${serverJoinKey(item)}:w:${item.start}`,
        start: item.start,
        end: item.end,
        label,
        ariaLabel: `${label}, ${formatLocalTime(item.start, tz)} to ${formatLocalTime(item.end, tz)}`,
    };
}

function toMarker(item: GameServerMarkerItemDto, detail: string, tz: string): CalendarLayerMarker {
    return {
        kind: 'marker',
        id: `${serverJoinKey(item)}:m:${item.at}`,
        at: item.at,
        glyph: 'power',
        tip: { title: markerTitle(item, tz), detail },
    };
}

export interface PelicanLayerInput {
    items: readonly GameServerCalendarItemDto[];
    statuses: readonly GameServerStatusDto[];
    slugById: ReadonlyMap<number, string>;
    selectedGames: ReadonlySet<string> | undefined;
    tz: string;
    /** Reference time for "checked N min ago" (epoch ms). */
    now: number;
}

/** Filter by game, then map each contract item to a layer item. */
export function toPelicanLayerItems(input: PelicanLayerInput): CalendarLayerItem[] {
    const statusByServer = new Map(input.statuses.map((s) => [serverJoinKey(s), s]));
    return input.items
        .filter((item) => isServerItemVisible(item.gameId, input.slugById, input.selectedGames))
        .map((item) => {
            if (item.kind === 'window') return toWindow(item, input.tz);
            const detail = liveLine(statusByServer.get(serverJoinKey(item)), input.now);
            return toMarker(item, detail, input.tz);
        });
}
