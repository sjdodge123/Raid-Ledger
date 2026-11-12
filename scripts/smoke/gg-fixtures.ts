/**
 * ROK-2187 — GG <year> smoke fixtures: a frozen `GgSnapshotV1` built from
 * literals (no IGDB game names — top games stay empty), seeded through the
 * DEMO_MODE fixture `POST /admin/test/gg/seed`, and the mocked Discord
 * mascot options the admin picker reads.
 */
import { API_BASE, apiPost, apiPut } from './api-helpers';

/** Discord snowflakes for the mocked mascot picker (never hit Discord). */
export const MASCOT_EMOJI_ID = '901234567890123456';
export const MASCOT_SOUND_ID = '901234567890123457';

/**
 * A year no other worker uses: desktop and mobile run concurrently as the same
 * admin, and a snapshot is keyed `(user, year)`.
 */
export function ggSmokeYear(parallelIndex: number): number {
    return 2040 + (parallelIndex % 50);
}

/** The co-player name only the owner's People card may show (never public). */
export function ggCoPlayerName(year: number): string {
    return `GgSmokeCoPlayer${year}`;
}

/** Intro → Events → People → Summary, all core cards (core is always on). */
export function buildGgSnapshot(year: number): Record<string, unknown> {
    const iso = new Date(Date.UTC(year, 11, 8, 18)).toISOString();
    return {
        schemaVersion: 1,
        year,
        window: { from: new Date(Date.UTC(year, 0, 1)).toISOString(), to: iso },
        tier: 'full',
        computedAt: iso,
        cards: [
            { pluginSlug: 'core', cardId: 'intro', order: 0, payload: { memberSince: null } },
            { pluginSlug: 'core', cardId: 'events', order: 10, payload: { signedUp: 3, attended: 2, noShows: 1, firstEventAt: null, lastEventAt: null } },
            {
                pluginSlug: 'core', cardId: 'people', order: 80,
                payload: {
                    people: [{ userId: 999_999, displayName: ggCoPlayerName(year), avatarUrl: null, sharedEvents: 2, sharedVoiceSeconds: 0 }],
                    playedWithCount: 1,
                },
            },
            { pluginSlug: 'core', cardId: 'summary', order: 120, payload: { eventsAttended: 2, hoursPlayedSeconds: 3600, topGames: [], playedWithCount: 1, superlative: 'regular' } },
        ],
    };
}

/** Seeds the admin's snapshot for `year` and turns sharing off (Q5 default). */
export async function seedGgSnapshot(token: string, userId: number, year: number): Promise<void> {
    const seeded = (await apiPost(token, '/admin/test/gg/seed', { userId, year, snapshot: buildGgSnapshot(year) })) as { year?: unknown };
    if (seeded.year !== year) throw new Error(`[gg] seed ${year} failed: ${JSON.stringify(seeded)}`);
    await apiPut(token, `/gg/${year}/share`, { shared: false });
}

/** afterAll cleanup: sharing off (kills any public slug) + the year's delivery state. */
export async function resetGgYear(token: string, year: number): Promise<void> {
    await apiPut(token, `/gg/${year}/share`, { shared: false });
    await apiPost(token, '/admin/test/gg/reset', { year });
}

/** Anonymous `GET /gg/public/:slug` status (no Authorization header). */
export async function publicGgStatus(slug: string): Promise<number> {
    return (await fetch(`${API_BASE}/gg/public/${encodeURIComponent(slug)}`)).status;
}

/** `GET /admin/gg/mascot/options` as the picker sees it — one emoji, one sound. */
export const MASCOT_OPTIONS = {
    emojis: [{ id: MASCOT_EMOJI_ID, name: 'smoke_wololo', animated: false, previewUrl: '/favicon.ico' }],
    sounds: [{ id: MASCOT_SOUND_ID, name: 'smoke chime', volume: 0.8, available: true, emojiName: null }],
};

/** The owner-read mascot block injected into `GET /gg/:year` (no sound file). */
export const OWNER_MASCOT = {
    emojiName: 'smoke_wololo', imageUrl: `/uploads/gg-mascot/${MASCOT_EMOJI_ID}.png`, soundUrl: null, volume: 0.8,
};
