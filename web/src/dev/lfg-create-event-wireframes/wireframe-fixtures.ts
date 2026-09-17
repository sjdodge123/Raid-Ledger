/**
 * ROK-1573/1572 wireframe fixtures — a realistic PEAK group, no network.
 *
 * Built on the shared LFG test factories so every object is a real contract
 * DTO; times are computed relative to "now" so "tonight" stays tonight.
 */
import type {
    GameDetailDto,
    LfgConvertedEventDto,
    LfgGroupDetailDto,
    LfgHistoryResponseDto,
    LfgOverlapResponseDto,
    LfgSuggestionsResponseDto,
} from '@raid-ledger/contract';
import {
    createMockHistoryEntry,
    createMockLfgGroupDetail,
    createMockLfgIntent,
    createMockLfgMember,
    createMockOverlapWindow,
    createMockSuggestion,
} from '../../test/lfg-factories';

export const WF_GAME_ID = 9001;
const STEAM_APP = 3527290;

/** `hour`:00 local, `daysAhead` days from today. */
function at(daysAhead: number, hour: number): Date {
    const d = new Date();
    d.setDate(d.getDate() + daysAhead);
    d.setHours(hour, 0, 0, 0);
    return d;
}

/** Days from today to the Friday at least two days out. */
function daysToFriday(): number {
    const today = new Date().getDay();
    const ahead = (5 - today + 7) % 7;
    return ahead < 2 ? ahead + 7 : ahead;
}

const TONIGHT = at(0, 20);
const FRIDAY = at(daysToFriday(), 20);
const inHours = (h: number): string => new Date(Date.now() + h * 3_600_000).toISOString();

/** The game detail `LfgHeader` renders (cover + badges). */
export const WF_GAME = {
    id: WF_GAME_ID, igdbId: null, name: 'PEAK', slug: 'peak',
    coverUrl: `https://cdn.cloudflare.steamstatic.com/steam/apps/${STEAM_APP}/library_600x900.jpg`,
    genres: [], summary: 'Co-op climbing with friends.', rating: null,
    aggregatedRating: null, popularity: null, gameModes: [], themes: [],
    platforms: [], screenshots: [], videos: [], firstReleaseDate: null,
    playerCount: { min: 1, max: 4 }, twitchGameId: null, crossplay: null,
    steamAppId: STEAM_APP, cooptimusOnlineMax: 4,
} as GameDetailDto;

const MEMBERS = [
    createMockLfgMember({ userId: 1, username: 'roknua', displayName: 'roknua', urgency: 'now', expiresAt: inHours(1) }),
    createMockLfgMember({ userId: 2, username: 'brian', displayName: 'Brian', urgency: 'now', expiresAt: inHours(0.75) }),
    createMockLfgMember({ userId: 3, username: 'jess', displayName: 'Jess', urgency: 'week', expiresAt: inHours(96) }),
    createMockLfgMember({ userId: 4, username: 'al', displayName: 'Al', urgency: 'week', expiresAt: inHours(200) }),
];

/** Four looking, the viewer (roknua) among them. */
export const WF_GROUP: LfgGroupDetailDto = createMockLfgGroupDetail({
    gameId: WF_GAME_ID, gameName: 'PEAK', gameSlug: 'peak',
    activeCount: 4, nowCount: 2, state: 'lfm', viabilityThreshold: 4,
    isViable: true, hasOwnIntent: true, members: MEMBERS,
    ownIntent: createMockLfgIntent({ gameId: WF_GAME_ID, urgency: 'now', ttlMinutes: 60 }),
    threadId: null, convertedEvent: null,
});

/** L4 — the event the group became. */
export const WF_CONVERTED_EVENT: LfgConvertedEventDto = {
    eventId: 777, title: 'PEAK — Friday climb',
    startTime: FRIDAY.toISOString(), signupCount: 4,
};

const WINDOWS = [
    createMockOverlapWindow({ start: TONIGHT.toISOString(), end: at(0, 22).toISOString(), availableCount: 4, totalCount: 4, members: [1, 2, 3, 4] }),
    createMockOverlapWindow({ start: FRIDAY.toISOString(), end: new Date(FRIDAY.getTime() + 2 * 3_600_000).toISOString(), availableCount: 3, totalCount: 4, members: [1, 2, 3] }),
];

/** Shared time exists (L1/L3/L4). */
export const WF_OVERLAP: LfgOverlapResponseDto = {
    gameId: WF_GAME_ID, memberCount: 4, horizonDays: 14, windows: WINDOWS,
};

/** No shared time (L2). */
export const WF_OVERLAP_EMPTY: LfgOverlapResponseDto = { ...WF_OVERLAP, windows: [] };

export const WF_HISTORY: LfgHistoryResponseDto = {
    gameId: WF_GAME_ID,
    entries: [
        createMockHistoryEntry({ eventId: 501, title: 'Summit attempt #3', startedAt: at(-6, 20).toISOString(), durationMinutes: 135, attendedCount: 4, signedUpCount: 4, participantIds: [1, 2, 3, 4] }),
        createMockHistoryEntry({ eventId: 502, title: 'Quick Play', isAdHoc: true, startedAt: at(-11, 21).toISOString(), durationMinutes: 50, attendedCount: 2, signedUpCount: 2, participantIds: [1, 2] }),
    ],
};

export const WF_SUGGESTIONS: LfgSuggestionsResponseDto = {
    gameId: WF_GAME_ID,
    suggestions: [
        createMockSuggestion({ userId: 11, username: 'mara', displayName: 'Mara', reasons: ['played', 'owns'] }),
        createMockSuggestion({ userId: 12, username: 'dex', displayName: 'Dex', reasons: ['owns'] }),
        createMockSuggestion({ userId: 13, username: 'kit', displayName: 'Kit', reasons: ['hearted'], inviteState: 'sent' }),
    ],
};

/** `8 PM` / `8:30 PM`. */
export function clock(iso: string): string {
    const d = new Date(iso);
    const h = d.getHours() % 12 === 0 ? 12 : d.getHours() % 12;
    const m = d.getMinutes() === 0 ? '' : `:${String(d.getMinutes()).padStart(2, '0')}`;
    return `${h}${m} ${d.getHours() < 12 ? 'AM' : 'PM'}`;
}

/** `Fri Sep 25, 8 PM`. */
export function dayAndClock(iso: string): string {
    const day = new Date(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    return `${day}, ${clock(iso)}`;
}

/** "Tonight 8 PM" — the best window's start, as L1b's primary label reads it. */
export const WF_BEST_TIME_LABEL = `Tonight ${clock(TONIGHT.toISOString())}`;
