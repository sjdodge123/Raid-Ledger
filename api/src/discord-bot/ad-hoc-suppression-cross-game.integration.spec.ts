/**
 * Cross-game channel-anchor suppression bounds (REVIEW-B R4).
 *
 * TDB:224 made a channel-anchored scheduled event occupy its voice channel for
 * EVERY game. That must hold only while the event is live: an ended (or
 * cancelled) game-Y event must not suppress a game-X join, and a live one
 * suppresses WITHOUT rolling its `extended_until` forward — otherwise a
 * different game's group keeps an ended raid alive for up to 6h.
 * Same-game joins keep the 30-min look-back + extension (pinned below), and a
 * same-game match wins over a cross-game anchor when both are live.
 *
 * New file: `ad-hoc-suppression.integration.spec.ts` is at 684/750.
 */
import { eq, sql } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { truncateAllTables } from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';
import { findActiveScheduledEvent } from './services/ad-hoc-event.helpers';
import { AdHocEventService } from './services/ad-hoc-event.service';
import { nonEmpty } from '../common/testing/narrow';

const UNRELATED_BINDING = '00000000-0000-0000-0000-000000000000';
const CHANNEL = 'voice-channel-C';

let testApp: TestApp;
let service: AdHocEventService;

beforeAll(async () => {
  testApp = await getTestApp();
  service = testApp.app.get(AdHocEventService);
});

afterEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
});

function minsFrom(base: Date, minutes: number): Date {
  return new Date(base.getTime() + minutes * 60_000);
}

/** Game Y = the seeded game; game X = an id no event carries. */
const gameY = () => testApp.seed.game.id;
const gameX = () => testApp.seed.game.id + 100_000;

async function createEvent(fields: {
  gameId: number | null;
  start: Date;
  end: Date;
  anchoredToC?: boolean;
  cancelledAt?: Date;
}): Promise<number> {
  const [event] = nonEmpty(
    await testApp.db
      .insert(schema.events)
      .values({
        title: 'Scheduled — cross-game fixture',
        creatorId: testApp.seed.adminUser.id,
        duration: [fields.start, fields.end] as [Date, Date],
        gameId: fields.gameId,
        ephemeralVoiceChannelId: fields.anchoredToC ? CHANNEL : null,
        cancelledAt: fields.cancelledAt ?? null,
      })
      .returning({ id: schema.events.id }),
    'event',
  );
  return event.id;
}

/** A real second game (events.game_id is a FK). */
async function createGameX(): Promise<number> {
  const [game] = nonEmpty(
    await testApp.db
      .insert(schema.games)
      .values({ name: 'Cross Game X', slug: 'cross-game-x', igdbId: null })
      .returning({ id: schema.games.id }),
    'game',
  );
  return game.id;
}

/** `extended_until` as epoch seconds, or null when never written. */
async function extEpoch(eventId: number): Promise<number | null> {
  const [row] = nonEmpty(
    await testApp.db
      .select({
        ext: sql<
          number | null
        >`extract(epoch from ${schema.events.extendedUntil})`,
      })
      .from(schema.events)
      .where(eq(schema.events.id, eventId)),
    'row',
  );
  return row.ext == null ? null : Number(row.ext);
}

describe('cross-game channel anchor — live only, never extended (REVIEW-B R4)', () => {
  it('an anchored game-Y event that ended 10 min ago does NOT suppress or extend on a game-X join', async () => {
    const now = new Date();
    const eventId = await createEvent({
      gameId: gameY(),
      start: minsFrom(now, -70),
      end: minsFrom(now, -10),
      anchoredToC: true,
    });

    const clearance = await service.ensureNotSuppressed(
      UNRELATED_BINDING,
      gameX(),
      CHANNEL,
    );

    expect(clearance).not.toBeNull();
    expect(await extEpoch(eventId)).toBeNull();
  });

  it('a cancelled anchored game-Y event does NOT suppress a game-X join', async () => {
    const now = new Date();
    await createEvent({
      gameId: gameY(),
      start: minsFrom(now, -30),
      end: minsFrom(now, 30),
      anchoredToC: true,
      cancelledAt: minsFrom(now, -5),
    });

    const match = await findActiveScheduledEvent(
      testApp.db,
      UNRELATED_BINDING,
      gameX(),
      now,
      CHANNEL,
    );
    expect(match).toBeUndefined();
  });

  it('a live anchored game-Y event suppresses a game-X join WITHOUT extending its window', async () => {
    const now = new Date();
    // Ends in 5 min: inside the refresh threshold, so a same-game join WOULD
    // write extended_until — the cross-game join must not.
    const eventId = await createEvent({
      gameId: gameY(),
      start: minsFrom(now, -55),
      end: minsFrom(now, 5),
      anchoredToC: true,
    });

    const clearance = await service.ensureNotSuppressed(
      UNRELATED_BINDING,
      gameX(),
      CHANNEL,
    );

    expect(clearance).toBeNull();
    expect(await extEpoch(eventId)).toBeNull();
  });

  it('PIN: a same-game join still suppresses inside the look-back and extends the window', async () => {
    const now = new Date();
    const eventId = await createEvent({
      gameId: gameY(),
      start: minsFrom(now, -70),
      end: minsFrom(now, -10),
      anchoredToC: true,
    });

    const clearance = await service.ensureNotSuppressed(
      UNRELATED_BINDING,
      gameY(),
      CHANNEL,
    );

    expect(clearance).toBeNull();
    expect(await extEpoch(eventId)).not.toBeNull();
  });
});

describe('match ordering — a same-game match wins over a cross-game anchor (REVIEW-B R4)', () => {
  it('returns the live game-X event, not the newer anchored game-Y event', async () => {
    const now = new Date();
    // Inserted FIRST and started LATER: heap order and start-time order both
    // favour the anchored game-Y row, so only the match-kind rank picks X.
    await createEvent({
      gameId: gameY(),
      start: minsFrom(now, -5),
      end: minsFrom(now, 60),
      anchoredToC: true,
    });
    const realGameX = await createGameX();
    const gameXEventId = await createEvent({
      gameId: realGameX,
      start: minsFrom(now, -60),
      end: minsFrom(now, 60),
    });

    const match = await findActiveScheduledEvent(
      testApp.db,
      UNRELATED_BINDING,
      realGameX,
      now,
      CHANNEL,
    );
    expect({ id: match?.id, matchedBy: match?.matchedBy }).toEqual({
      id: gameXEventId,
      matchedBy: 'game',
    });
  });
});
