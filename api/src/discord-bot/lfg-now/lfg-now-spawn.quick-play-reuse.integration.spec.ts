/**
 * ROK-1888 — one live Quick Play per game, LFG-now included.
 *
 * LFG-now used to spawn under its own group lock only, and its "open event"
 * guard only sees LFG-born events (an `lfg_intents` row points at them). So a
 * "start playing now" while a voice- or server-spawned Quick Play was live
 * minted a SECOND live event for the game. The spawn now also takes the
 * per-game Quick Play lock and reuses the game's live Quick Play.
 *
 * Regression: ROK-1888
 */
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import { truncateAllTables } from '../../common/testing/integration-helpers';
import { nonEmpty } from '../../common/testing/narrow';
import * as schema from '../../drizzle/schema';
import {
  createVoiceQuickPlay,
  findLiveQuickPlayGameIds,
} from '../services/ad-hoc-game-spawn-lock';
import { spawnUnderGroupLock } from './lfg-now-spawn.helpers';

let testApp: TestApp;
let gameId: number;
let otherGameId: number;
let bindingId: string;

beforeAll(async () => {
  testApp = await getTestApp();
});

beforeEach(async () => {
  gameId = await seedGame('Valheim', 'valheim-1888');
  otherGameId = await seedGame('CoD4', 'cod4-1888');
  const [binding] = nonEmpty(
    await testApp.db
      .insert(schema.channelBindings)
      .values({
        guildId: 'guild-1888',
        channelId: '1888000000000000001',
        channelType: 'voice',
        bindingPurpose: 'game-voice-monitor',
        gameId,
        config: { minPlayers: 2 },
      })
      .returning({ id: schema.channelBindings.id }),
    'binding',
  );
  bindingId = binding.id;
});

afterEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
});

async function seedGame(name: string, slug: string): Promise<number> {
  const [row] = nonEmpty(
    await testApp.db
      .insert(schema.games)
      .values({ name, slug, coverUrl: null, igdbId: null })
      .returning({ id: schema.games.id }),
    name,
  );
  return row.id;
}

async function liveEventIds(game: number): Promise<number[]> {
  const rows = await testApp.db
    .select({ id: schema.events.id })
    .from(schema.events)
    .where(
      and(
        eq(schema.events.gameId, game),
        eq(schema.events.isAdHoc, true),
        inArray(schema.events.adHocStatus, ['live', 'grace_period']),
        isNull(schema.events.cancelledAt),
      ),
    );
  return rows.map((r) => r.id);
}

async function voiceQuickPlay(): Promise<number> {
  const spawned = await createVoiceQuickPlay(
    testApp.db,
    bindingId,
    { gameId },
    { userId: testApp.seed.adminUser.id },
    'Valheim',
  );
  return nonEmpty(spawned ? [spawned] : [], 'voice Quick Play')[0].eventId;
}

describe('LFG-now start while a voice Quick Play is live (ROK-1888)', () => {
  it('joins the live Quick Play instead of creating a second event', async () => {
    const voiceEvent = await voiceQuickPlay();

    const result = await spawnUnderGroupLock(testApp.db, gameId, new Date(), {
      manual: { starterUserId: testApp.seed.adminUser.id },
    });

    expect(result).toEqual({
      eventId: voiceEvent,
      spawned: false,
      invitedUserIds: [],
    });
    expect(await liveEventIds(gameId)).toEqual([voiceEvent]);
  });

  it('still creates an LFG-now event when the game has no live Quick Play', async () => {
    await voiceQuickPlay();

    const result = await spawnUnderGroupLock(
      testApp.db,
      otherGameId,
      new Date(),
      { manual: { starterUserId: testApp.seed.adminUser.id } },
    );

    expect(result?.spawned).toBe(true);
    expect(await liveEventIds(otherGameId)).toEqual([result?.eventId]);
  });
});

describe('LFG-now start while the Quick Play is in grace (ROK-1888 m4)', () => {
  it('restores the in-grace Quick Play to live when the starter attaches', async () => {
    const voiceEvent = await voiceQuickPlay();
    await testApp.db
      .update(schema.events)
      .set({ adHocStatus: 'grace_period' })
      .where(eq(schema.events.id, voiceEvent));

    const result = await spawnUnderGroupLock(testApp.db, gameId, new Date(), {
      manual: { starterUserId: testApp.seed.adminUser.id },
    });

    expect(result?.eventId).toBe(voiceEvent);
    const [row] = await testApp.db
      .select({ status: schema.events.adHocStatus })
      .from(schema.events)
      .where(eq(schema.events.id, voiceEvent));
    expect(row?.status).toBe('live');
  });
});

describe('createVoiceQuickPlay joinOnly (ROK-1888 m2)', () => {
  it('returns null and inserts nothing when no live Quick Play exists', async () => {
    const result = await createVoiceQuickPlay(
      testApp.db,
      bindingId,
      { gameId },
      { userId: testApp.seed.adminUser.id },
      'Valheim',
      true,
    );

    expect(result).toBeNull();
    expect(await liveEventIds(gameId)).toEqual([]);
  });

  it('joins the live Quick Play when one exists', async () => {
    const voiceEvent = await voiceQuickPlay();

    const result = await createVoiceQuickPlay(
      testApp.db,
      bindingId,
      { gameId },
      { userId: testApp.seed.adminUser.id },
      'Valheim',
      true,
    );

    expect(result).toEqual({ eventId: voiceEvent, existing: true });
  });
});

describe('findLiveQuickPlayGameIds (ROK-1888)', () => {
  it('returns the ids of games with a live Quick Play from any channel', async () => {
    await voiceQuickPlay();

    const live = await findLiveQuickPlayGameIds(testApp.db, [
      gameId,
      otherGameId,
    ]);

    expect([...live]).toEqual([gameId]);
    expect(await findLiveQuickPlayGameIds(testApp.db, [])).toEqual(new Set());
  });
});
