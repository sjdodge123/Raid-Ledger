/**
 * ROK-2185 item 3 — the Events tab's "Show more" source: the hub's full
 * ended-event history via `GET /guilds/:id/events/past` (20 a page).
 * Nothing is fetched until the first click. Each click shows up to 20 rows
 * not already on screen: rows fetched beyond that wait in a buffer, and a
 * page that is mostly repeats (the newest page overlaps `raids.recent`) is
 * followed by the next page within the same click.
 */
import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
    GUILD_PAST_EVENTS_PAGE_SIZE,
    type GuildKind,
    type GuildRecentEventDto,
    type HubStatus,
    type LadderRole,
} from '@raid-ledger/contract';
import { fetchGuildPastEvents } from './guild-api';

/** The page fields that decide whether the viewer may read (and so page) a hub's events. */
export interface PastPagingAccess {
    viewer: { role: LadderRole };
    guild: { kind: GuildKind };
    community?: { status: HubStatus } | undefined;
}

/**
 * The server's `canReadOverview` rule: members and staff, plus any signed-in
 * visitor on an active community hub (hidden hubs never reach a visitor).
 */
export function canPagePastEvents(page: PastPagingAccess): boolean {
    if (page.viewer.role !== 'visitor') return true;
    return page.guild.kind === 'game_community' && page.community?.status === 'active';
}

interface Fresh { events: GuildRecentEventDto[]; nextCursor: string | null }

/** From `cursor`, fetch pages until `want` rows absent from `seen` arrived or history ends. */
export async function fetchNewPastEvents(
    guildId: number, cursor: string | null, seen: ReadonlySet<number>, want: number,
): Promise<Fresh> {
    const ids = new Set(seen);
    const events: GuildRecentEventDto[] = [];
    let next = cursor;
    do {
        const page = await fetchGuildPastEvents(guildId, next);
        for (const e of page.events) {
            if (ids.has(e.id)) continue;
            ids.add(e.id);
            events.push(e);
        }
        next = page.nextCursor;
    } while (events.length < want && next !== null);
    return { events, nextCursor: next };
}

interface PastState {
    /** The hub these rows belong to — state for any other hub reads as {@link initial}. */
    guildId: number;
    shown: GuildRecentEventDto[]; buffer: GuildRecentEventDto[]; cursor: string | null; started: boolean; lastAdded: number | null;
}

function initial(guildId: number): PastState {
    return { guildId, shown: [], buffer: [], cursor: null, started: false, lastAdded: null };
}

/** `s` when it is `guildId`'s, else a clean start — a hub switch never carries rows or a cursor over. */
function forGuild(s: PastState, guildId: number): PastState {
    return s.guildId === guildId ? s : initial(guildId);
}

function reveal(s: PastState, fresh: GuildRecentEventDto[], cursor: string | null): PastState {
    const pool = [...s.buffer, ...fresh];
    const add = pool.slice(0, GUILD_PAST_EVENTS_PAGE_SIZE);
    return { ...s, shown: [...s.shown, ...add], buffer: pool.slice(add.length), cursor, started: true, lastAdded: add.length };
}

interface LoadVars { guildId: number; cursor: string | null; seen: ReadonlySet<number>; want: number }

export interface GuildPastEvents {
    /** Older rows revealed so far (never repeating `recent`). */
    shown: GuildRecentEventDto[];
    /** More could exist: not asked yet, rows buffered, or a cursor left. */
    canShowMore: boolean;
    /** The last click found nothing new. */
    foundNothing: boolean;
    isLoading: boolean;
    isError: boolean;
    showMore: () => void;
}

/** Click-driven paging of a hub's ended events beyond `recent`; state is scoped to `guildId`. */
export function useGuildPastEvents(guildId: number, recent: readonly GuildRecentEventDto[]): GuildPastEvents {
    const [stored, setState] = useState<PastState>(() => initial(guildId));
    const state = forGuild(stored, guildId);
    const current = useRef(guildId);
    useEffect(() => { current.current = guildId; }, [guildId]);
    const load = useMutation({
        mutationFn: (v: LoadVars) => fetchNewPastEvents(v.guildId, v.cursor, v.seen, v.want),
        // A page for a hub the viewer already left is dropped, never merged into this hub's rows.
        onSuccess: (fresh, v) => {
            if (v.guildId === current.current) setState((s) => reveal(forGuild(s, v.guildId), fresh.events, fresh.nextCursor));
        },
    });
    const mine = load.variables?.guildId === guildId;
    const showMore = (): void => {
        const want = GUILD_PAST_EVENTS_PAGE_SIZE - state.buffer.length;
        if (want <= 0 || (state.started && state.cursor === null)) {
            setState((s) => { const cur = forGuild(s, guildId); return reveal(cur, [], cur.cursor); });
            return;
        }
        const seen = new Set([...recent, ...state.shown, ...state.buffer].map((e) => e.id));
        load.mutate({ guildId, cursor: state.cursor, seen, want });
    };
    return {
        shown: state.shown,
        canShowMore: !state.started || state.buffer.length > 0 || state.cursor !== null,
        foundNothing: state.lastAdded === 0,
        isLoading: mine && load.isPending,
        isError: mine && load.isError,
        showMore,
    };
}
