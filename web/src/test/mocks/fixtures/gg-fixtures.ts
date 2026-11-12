/** Synthetic "GG <year>" fixtures (ROK-2187) — no real names. */
import type { GgCardEnvelope, GgPublicSummaryDto } from '@raid-ledger/contract';
import type { GgOwnerSnapshot } from '../../../lib/api/gg-api';

const card = (pluginSlug: string, cardId: string, order: number, payload: unknown): GgCardEnvelope =>
    ({ pluginSlug, cardId, order, payload });

const topGames = [
    { gameId: 7, name: 'WoW: Forever', coverUrl: null, seconds: 763_200 },
    { gameId: 8, name: 'Valheim', coverUrl: null, seconds: 345_600 },
];

/** A full year: every core card plus Valheim. */
export const ggFullCards: GgCardEnvelope[] = [
    card('core', 'intro', 0, { memberSince: null }),
    card('core', 'events', 10, { signedUp: 50, attended: 47, noShows: 0, firstEventAt: null, lastEventAt: null }),
    card('core', 'on-time', 20, { attended: 47, onTime: 44, onTimeRatio: 0.94 }),
    card('core', 'rhythm', 30, { busiestMonth: 3, busiestMonthEvents: 8, favouriteWeekday: 4, favouriteHour: 22 }),
    card('core', 'hours', 40, { totalSeconds: 1_368_000, gamesPlayed: 5, nightOwlShare: 0.68 }),
    card('core', 'top-games', 50, { games: topGames, byMonth: [] }),
    card('core', 'new-games', 60, { count: 1, games: [{ gameId: 9, name: 'Enshrouded' }] }),
    card('core', 'voice', 70, { totalSeconds: 463_200, sessions: 61 }),
    card('core', 'people', 80, { people: [{ userId: 2, displayName: 'Brindle', avatarUrl: null, sharedEvents: 31, sharedVoiceSeconds: 0 }], playedWithCount: 38 }),
    card('core', 'hubs', 90, { joined: 3, posts: 64, pictures: 112 }),
    card('valheim', 'valheim-year', 100, { characters: 1, deaths: 12, skillGains: [{ skill: 'Swords', gained: 20 }] }),
    card('core', 'superlative', 200, { key: 'night-owl', value: 0.68 }),
    card('core', 'summary', 210, { eventsAttended: 47, hoursPlayedSeconds: 1_368_000, topGames, playedWithCount: 38, superlative: 'night-owl' }),
];

/** The owner snapshot the routes read. */
export function ggSnapshotFixture(over: Partial<GgOwnerSnapshot> = {}): GgOwnerSnapshot {
    return {
        year: 2026,
        tier: 'full',
        computedAt: '2026-12-14T18:00:00.000Z',
        cards: ggFullCards,
        share: { shared: false, slug: null, sharedAt: null },
        archiveYears: [2026, 2025],
        mascot: null,
        ...over,
    };
}

/** The public summary for `/w/:slug`. */
export const ggPublicFixture: GgPublicSummaryDto = {
    year: 2026,
    displayName: 'Kestrel',
    avatarUrl: null,
    eventsAttended: 47,
    hoursPlayedSeconds: 1_368_000,
    topGames: [{ name: 'WoW: Forever', coverUrl: null }],
    playedWithCount: 38,
    superlative: 'night-owl',
};
