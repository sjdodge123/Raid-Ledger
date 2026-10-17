/**
 * ROK-1494 D9 — unit coverage for `readPlayingNow` and its wiring.
 *
 * Written BEFORE the implementation. What it pins:
 *   1. The projection: `GET /lfg/:gameId` must be able to say "event yes,
 *      voice channel not yet" (the temp channel is created AFTER the spawn
 *      transaction commits), so `voiceChannelId`/`voiceInviteUrl` are nullable
 *      independently of `eventId`.
 *   2. The wiring: `getGroupSummary` attaches it on BOTH branches — the
 *      zero-count branch is the spawned case (every intent converted, so
 *      `activeCount` is 0 and the aggregate row does not exist at all).
 */
import {
  buildVoiceInviteUrl,
  readPlayingNow,
  openLfgNowEventWhere,
} from './lfg-playing.helpers';
import { getGroupSummary, type LfgDb } from './lfg-query.helpers';
import { createDrizzleMock } from '../common/testing/drizzle-mock';
import * as schema from '../drizzle/schema';

const STARTS_AT = new Date('2026-09-06T18:00:00.000Z');
const ENDS_AT = new Date('2026-09-06T19:00:00.000Z');

/** One row as the single `readPlayingNow` select returns it. */
function playingRow(over: Record<string, unknown> = {}) {
  return {
    eventId: 77,
    duration: [STARTS_AT, ENDS_AT] as [Date, Date],
    voiceChannelId: '999000111',
    guildId: '123456789',
    participantCount: 2,
    ...over,
  };
}

const GAME: typeof schema.games.$inferSelect = {
  id: 42,
  name: 'Deep Rock Galactic',
  slug: 'deep-rock-galactic',
  coverUrl: null,
  cooptimusOnlineMax: null,
} as typeof schema.games.$inferSelect;

describe('buildVoiceInviteUrl', () => {
  it('builds the deep link only when BOTH ids are known (A8)', () => {
    expect(buildVoiceInviteUrl('123', '999')).toBe(
      'https://discord.com/channels/123/999',
    );
    expect(buildVoiceInviteUrl(null, '999')).toBeNull();
    expect(buildVoiceInviteUrl('123', null)).toBeNull();
    expect(buildVoiceInviteUrl(null, null)).toBeNull();
  });
});

describe('readPlayingNow', () => {
  it('returns null when the game has no open LFG-born event', async () => {
    const db = createDrizzleMock();
    db.limit.mockResolvedValue([]);
    await expect(
      readPlayingNow(db as unknown as LfgDb, 42),
    ).resolves.toBeNull();
  });

  it('projects the open session onto the wire DTO', async () => {
    const db = createDrizzleMock();
    db.limit.mockResolvedValue([playingRow()]);
    await expect(readPlayingNow(db as unknown as LfgDb, 42)).resolves.toEqual({
      eventId: 77,
      startsAt: STARTS_AT.toISOString(),
      voiceChannelId: '999000111',
      voiceInviteUrl: 'https://discord.com/channels/123456789/999000111',
      participantCount: 2,
    });
  });

  it('reports the event with a null channel in the pre-createForEvent window', async () => {
    const db = createDrizzleMock();
    db.limit.mockResolvedValue([
      playingRow({ voiceChannelId: null, participantCount: 0 }),
    ]);
    const result = await readPlayingNow(db as unknown as LfgDb, 42);
    expect(result).not.toBeNull();
    expect(result?.eventId).toBe(77);
    expect(result?.voiceChannelId).toBeNull();
    expect(result?.voiceInviteUrl).toBeNull();
    expect(result?.participantCount).toBe(0);
  });

  it('drops the deep link when no guild is known, keeping the channel id', async () => {
    const db = createDrizzleMock();
    db.limit.mockResolvedValue([playingRow({ guildId: null })]);
    const result = await readPlayingNow(db as unknown as LfgDb, 42);
    expect(result?.voiceChannelId).toBe('999000111');
    expect(result?.voiceInviteUrl).toBeNull();
  });

  it('coerces a driver-string head-count to a number', async () => {
    const db = createDrizzleMock();
    db.limit.mockResolvedValue([playingRow({ participantCount: '3' })]);
    const result = await readPlayingNow(db as unknown as LfgDb, 42);
    expect(result?.participantCount).toBe(3);
  });

  it('exports the open-event predicate the spawn guard shares', () => {
    expect(openLfgNowEventWhere(42)).toBeDefined();
  });
});

describe('getGroupSummary — playingNow wiring (D9)', () => {
  it('attaches the session even when every intent has converted (activeCount 0)', async () => {
    const db = createDrizzleMock();
    // The aggregate query terminates on `.groupBy` and finds nothing, because
    // the spawn converted every intent — this is AC3's exact state.
    db.groupBy.mockResolvedValue([]);
    db.limit.mockResolvedValue([playingRow()]);
    const summary = await getGroupSummary(db as unknown as LfgDb, GAME, 1);
    expect(summary.activeCount).toBe(0);
    expect(summary.playingNow).toEqual({
      eventId: 77,
      startsAt: STARTS_AT.toISOString(),
      voiceChannelId: '999000111',
      voiceInviteUrl: 'https://discord.com/channels/123456789/999000111',
      participantCount: 2,
    });
  });

  it('attaches the session alongside a live aggregate row', async () => {
    const db = createDrizzleMock();
    db.groupBy.mockResolvedValue([
      {
        gameId: 42,
        gameName: 'Deep Rock Galactic',
        gameSlug: 'deep-rock-galactic',
        gameCoverUrl: null,
        viabilityThreshold: null,
        activeCount: 2,
        soonestExpiresAt: null,
        hasOwnIntent: false,
        nowCount: 2,
        soonestNowExpiresAt: null,
      },
    ]);
    db.limit.mockResolvedValue([playingRow()]);
    const summary = await getGroupSummary(db as unknown as LfgDb, GAME, 1);
    expect(summary.activeCount).toBe(2);
    expect(summary.playingNow?.eventId).toBe(77);
  });

  it('reports playingNow: null for a group that never spawned', async () => {
    const db = createDrizzleMock();
    db.groupBy.mockResolvedValue([]);
    db.limit.mockResolvedValue([]);
    const summary = await getGroupSummary(db as unknown as LfgDb, GAME, 1);
    expect(summary.playingNow).toBeNull();
  });
});
