/**
 * ROK-2352 — the Any group's Quick Play fallback never lands on a keyed
 * group's session.
 *
 * A keyed Start now (a WoW dungeon run) is a live Quick Play of the game. The
 * Any (`''`) group's `findOpenSession` falls back to the game's live Quick
 * Play when its own hands converted into nothing; unscoped, that fallback
 * handed the Any group the dungeon's session.
 */
import { eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import { truncateAllTables } from '../../common/testing/integration-helpers';
import { nonEmpty } from '../../common/testing/narrow';
import * as schema from '../../drizzle/schema';
import { createVoiceQuickPlay } from '../services/ad-hoc-game-spawn-lock';
import { findAnyGroupQuickPlay } from './lfg-now-any-session.helpers';
import { spawnUnderGroupLock } from './lfg-now-spawn.helpers';

let testApp: TestApp;
let gameId: number;
let bindingId: string;

beforeAll(async () => {
  testApp = await getTestApp();
});

beforeEach(async () => {
  const [game] = nonEmpty(
    await testApp.db
      .insert(schema.games)
      .values({ name: 'WoW 2352', slug: 'wow-2352-any', igdbId: null })
      .returning({ id: schema.games.id }),
    'game',
  );
  gameId = game.id;
  const [binding] = nonEmpty(
    await testApp.db
      .insert(schema.channelBindings)
      .values({
        guildId: 'guild-2352',
        channelId: '2352000000000000001',
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

async function liveQuickPlay(): Promise<number> {
  const spawned = await createVoiceQuickPlay(
    testApp.db,
    bindingId,
    { gameId },
    { userId: testApp.seed.adminUser.id },
    'WoW 2352',
  );
  return nonEmpty(spawned ? [spawned] : [], 'Quick Play')[0].eventId;
}

/** Make `eventId` a group's session: a hand of that group converted into it. */
async function convertHandInto(eventId: number, groupKey: string) {
  await testApp.db.insert(schema.lfgIntents).values({
    userId: testApp.seed.adminUser.id,
    gameId,
    status: 'converted',
    urgency: 'now',
    ttlMinutes: 60,
    expiresAt: new Date(Date.now() + 60 * 60_000),
    groupKey,
    convertedToEventId: eventId,
  });
}

describe('findAnyGroupQuickPlay (ROK-2352)', () => {
  it('returns a plain live Quick Play', async () => {
    const eventId = await liveQuickPlay();

    await expect(findAnyGroupQuickPlay(testApp.db, gameId)).resolves.toBe(
      eventId,
    );
  });

  it('never returns a keyed group’s session', async () => {
    const keyed = await liveQuickPlay();
    await convertHandInto(keyed, 'raid:409');

    await expect(findAnyGroupQuickPlay(testApp.db, gameId)).resolves.toBeNull();
  });

  it('still returns a session the Any group’s own hands converted into', async () => {
    const anySession = await liveQuickPlay();
    await convertHandInto(anySession, '');

    await expect(findAnyGroupQuickPlay(testApp.db, gameId)).resolves.toBe(
      anySession,
    );
  });
});

describe('Any-group Start now beside a keyed session (ROK-2352)', () => {
  it('starts its own session instead of joining the keyed one', async () => {
    const keyed = await liveQuickPlay();
    await convertHandInto(keyed, 'raid:409');

    const result = await spawnUnderGroupLock(testApp.db, gameId, new Date(), {
      manual: { starterUserId: testApp.seed.adminUser.id },
      group: { scope: '', adapter: null },
    });

    expect(result?.spawned).toBe(true);
    expect(result?.eventId).not.toBe(keyed);
    const [keyedRow] = await testApp.db
      .select({ status: schema.events.adHocStatus })
      .from(schema.events)
      .where(eq(schema.events.id, keyed));
    expect(keyedRow?.status).toBe('live');
  });
});
