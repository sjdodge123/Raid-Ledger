/**
 * Ad-Hoc Suppression Integration Tests (batch B1-2, ROK-1418).
 *
 * The real regression net for the two ROK-1418 defects:
 *   1. `events.game_id` suppression was unscoped — a scheduled event in an
 *      unrelated voice channel suppressed Quick Play everywhere.
 *   2. The suppression path rewrote `extended_until` to now+1h on EVERY
 *      suppressed join (hardcoded `null` currentExtended), moving it backward
 *      and self-extending unboundedly.
 *
 * Every existing suppression assertion is SQL-text or arg-threading on a mocked
 * db and can be satisfied by a behaviourally-wrong refactor — hence a real pg16
 * harness here. A new file is required because `ad-hoc-events.integration.spec`
 * is already at 711/750.
 *
 * Time assertions read `extract(epoch from ...)` in SQL so `extended_until`
 * (timestamp) and `upper(duration)` (tsrange) are compared in the SAME frame,
 * immune to JS local-timezone round-trip drift.
 *
 * Regression: ROK-1418
 */
import { eq, sql } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { truncateAllTables } from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';
import { findActiveScheduledEvent } from './services/ad-hoc-event.helpers';
import { AdHocEventService } from './services/ad-hoc-event.service';

/** A valid UUID that never matches a seeded binding (the "querying" binding). */
const UNRELATED_BINDING = '00000000-0000-0000-0000-000000000000';
const HOUR_S = 60 * 60;

let testApp: TestApp;
let service: AdHocEventService;

beforeAll(async () => {
  testApp = await getTestApp();
  service = testApp.app.get(AdHocEventService);
});

afterEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
});

/** Minutes offset from a base Date. */
function minsFrom(base: Date, minutes: number): Date {
  return new Date(base.getTime() + minutes * 60_000);
}

async function createScheduledEvent(fields: {
  gameId?: number | null;
  start: Date;
  end: Date;
  extendedUntil?: Date | null;
  ephemeralVoiceChannelId?: string | null;
  recurrenceGroupId?: string | null;
  channelBindingId?: string | null;
  isAdHoc?: boolean;
}): Promise<number> {
  const [event] = await testApp.db
    .insert(schema.events)
    .values({
      title: 'Scheduled — suppression fixture',
      creatorId: testApp.seed.adminUser.id,
      duration: [fields.start, fields.end] as [Date, Date],
      gameId: fields.gameId ?? null,
      extendedUntil: fields.extendedUntil ?? null,
      ephemeralVoiceChannelId: fields.ephemeralVoiceChannelId ?? null,
      recurrenceGroupId: fields.recurrenceGroupId ?? null,
      channelBindingId: fields.channelBindingId ?? null,
      isAdHoc: fields.isAdHoc ?? false,
    })
    .returning({ id: schema.events.id });
  return event.id;
}

async function createVoiceBinding(fields: {
  channelId: string;
  bindingPurpose?: string;
  gameId?: number | null;
  recurrenceGroupId?: string | null;
}): Promise<string> {
  const [binding] = await testApp.db
    .insert(schema.channelBindings)
    .values({
      guildId: 'guild-1418',
      channelId: fields.channelId,
      channelType: 'voice',
      bindingPurpose: fields.bindingPurpose ?? 'game-voice-monitor',
      gameId: fields.gameId ?? null,
      recurrenceGroupId: fields.recurrenceGroupId ?? null,
      config: {},
    })
    .returning({ id: schema.channelBindings.id });
  return binding.id;
}

/**
 * Read `extended_until` and `upper(duration)` as epoch seconds via SQL so both
 * columns share the DB's frame (drift-proof). `extEpoch` is null when the
 * suppression window has never been written.
 */
async function readEpochs(
  eventId: number,
): Promise<{ extEpoch: number | null; endEpoch: number }> {
  const [row] = await testApp.db
    .select({
      extEpoch: sql<
        number | null
      >`extract(epoch from ${schema.events.extendedUntil})`,
      endEpoch: sql<number>`extract(epoch from upper(${schema.events.duration}))`,
    })
    .from(schema.events)
    .where(eq(schema.events.id, eventId))
    .limit(1);
  return {
    extEpoch: row.extEpoch == null ? null : Number(row.extEpoch),
    endEpoch: Number(row.endEpoch),
  };
}

// ── Suppression predicate scoping (Regression: ROK-1418) ─────────────
describe('ad-hoc suppression predicate scoping (Regression: ROK-1418)', () => {
  // Case 1 — PIN: written and confirmed FIRST. A "website" event with no
  // channel affinity (both anchors NULL) must still suppress Quick Play for
  // the same game. Guards against the fix silently deleting ROK-293
  // suppression. MUST PASS on today's unmodified code.
  it('case 1 — affinity-free scheduled event still suppresses (ROK-293 pin)', async () => {
    const now = new Date();
    const gameId = testApp.seed.game.id;
    await createScheduledEvent({
      gameId,
      start: minsFrom(now, -30),
      end: minsFrom(now, 30),
      ephemeralVoiceChannelId: null,
      recurrenceGroupId: null,
    });

    const match = await findActiveScheduledEvent(
      testApp.db,
      UNRELATED_BINDING,
      gameId,
      now,
      'voice-channel-C',
    );
    expect(match).toBeDefined();
  });

  // Case 2 — RED today: an event demonstrably homed in voice channel D must
  // NOT suppress Quick Play in unrelated channel C. Today the bare game_id
  // term fires regardless of the ephemeral anchor, so it IS (wrongly) found.
  it('case 2 — event homed in another voice channel does NOT suppress (RED today)', async () => {
    const now = new Date();
    const gameId = testApp.seed.game.id;
    await createScheduledEvent({
      gameId,
      start: minsFrom(now, -30),
      end: minsFrom(now, 30),
      ephemeralVoiceChannelId: 'voice-channel-D',
      recurrenceGroupId: null,
    });

    const match = await findActiveScheduledEvent(
      testApp.db,
      UNRELATED_BINDING,
      gameId,
      now,
      'voice-channel-C',
    );
    expect(match).toBeUndefined();
  });

  // Case 3 — PIN: a series event bound (by recurrence group) to THIS voice
  // channel still suppresses (ROK-1389/1390).
  it('case 3 — series event bound to this channel still suppresses', async () => {
    const now = new Date();
    const gameId = testApp.seed.game.id;
    const recurrenceGroupId = randomUUID();
    await createVoiceBinding({
      channelId: 'voice-channel-C',
      bindingPurpose: 'game-voice-monitor',
      recurrenceGroupId,
    });
    await createScheduledEvent({
      gameId,
      start: minsFrom(now, -30),
      end: minsFrom(now, 30),
      recurrenceGroupId,
    });

    const match = await findActiveScheduledEvent(
      testApp.db,
      UNRELATED_BINDING,
      gameId,
      now,
      'voice-channel-C',
    );
    expect(match).toBeDefined();
  });

  // Case 4 — PIN: a series event NOT homed to any voice channel still
  // suppresses (the NOT-EXISTS branch of the anchor).
  it('case 4 — unanchored series event still suppresses', async () => {
    const now = new Date();
    const gameId = testApp.seed.game.id;
    await createScheduledEvent({
      gameId,
      start: minsFrom(now, -30),
      end: minsFrom(now, 30),
      recurrenceGroupId: randomUUID(), // no voice binding references this group
    });

    const match = await findActiveScheduledEvent(
      testApp.db,
      UNRELATED_BINDING,
      gameId,
      now,
      'voice-channel-C',
    );
    expect(match).toBeDefined();
  });

  // Case 5 — PIN: the ROK-959 sibling-binding path (channel-level subquery) is
  // untouched by the fix. Event on a sibling monitor binding on the same
  // physical channel suppresses even with no game match.
  it('case 5 — sibling binding on the same channel still suppresses (ROK-959 pin)', async () => {
    const now = new Date();
    const siblingBindingId = await createVoiceBinding({
      channelId: 'voice-channel-C',
      bindingPurpose: 'game-voice-monitor',
    });
    await createScheduledEvent({
      gameId: null,
      start: minsFrom(now, -30),
      end: minsFrom(now, 30),
      channelBindingId: siblingBindingId,
    });

    const match = await findActiveScheduledEvent(
      testApp.db,
      UNRELATED_BINDING,
      null,
      now,
      'voice-channel-C',
    );
    expect(match).toBeDefined();
  });

  // Case 6 — PIN: ad-hoc events never suppress other ad-hoc spawns.
  it('case 6 — is_ad_hoc=true events are excluded from suppression', async () => {
    const now = new Date();
    const gameId = testApp.seed.game.id;
    await createScheduledEvent({
      gameId,
      start: minsFrom(now, -30),
      end: minsFrom(now, 30),
      isAdHoc: true,
    });

    const match = await findActiveScheduledEvent(
      testApp.db,
      UNRELATED_BINDING,
      gameId,
      now,
      'voice-channel-C',
    );
    expect(match).toBeUndefined();
  });

  // Case 10 — PIN: window self-reference. A past-end event whose
  // extended_until is still in the future IS found; once that window lapses it
  // is NOT found.
  it('case 10 — past-end event is found while its extended window is live, not after', async () => {
    const now = new Date();
    const gameId = testApp.seed.game.id;

    const liveWindowId = await createScheduledEvent({
      gameId,
      start: minsFrom(now, -180),
      end: minsFrom(now, -120), // ended 2h ago
      extendedUntil: minsFrom(now, 10), // window still open
    });
    const lapsedWindowId = await createScheduledEvent({
      gameId,
      start: minsFrom(now, -180),
      end: minsFrom(now, -120),
      extendedUntil: minsFrom(now, -10), // window already closed
    });

    const foundLive = await findActiveScheduledEvent(
      testApp.db,
      UNRELATED_BINDING,
      gameId,
      now,
    );
    expect(foundLive?.id).toBe(liveWindowId);

    // Remove the live-window event so only the lapsed one can match by game.
    await testApp.db
      .delete(schema.events)
      .where(eq(schema.events.id, liveWindowId));
    void lapsedWindowId;

    const foundLapsed = await findActiveScheduledEvent(
      testApp.db,
      UNRELATED_BINDING,
      gameId,
      now,
    );
    expect(foundLapsed).toBeUndefined();
  });
});

// ── Bounded extension window (Regression: ROK-1418) ──────────────────
describe('bounded extension window (Regression: ROK-1418)', () => {
  const gameId = () => testApp.seed.game.id;

  // Case 7 — RED today: a fresh window (extended_until well inside the 15m
  // refresh threshold's forward horizon) is NOT rewritten. Today every join
  // rewrites it to now+1h.
  it('case 7 — a fresh window is not rewritten on a suppressed join (RED today)', async () => {
    const now = new Date();
    const eventId = await createScheduledEvent({
      gameId: gameId(),
      start: minsFrom(now, -30),
      end: minsFrom(now, 30),
      extendedUntil: minsFrom(now, 40), // fresh (>= now+15m)
    });
    const before = await readEpochs(eventId);

    const suppressed = await service.trySuppressForScheduled(
      UNRELATED_BINDING,
      gameId(),
      undefined,
    );
    expect(suppressed).toBe(true);

    const after = await readEpochs(eventId);
    expect(Math.abs((after.extEpoch ?? 0) - (before.extEpoch ?? 0))).toBeLessThan(2);
  });

  // Case 8 — RED today: the guard never moves extended_until backward. A
  // window further out than now+1h must survive a suppressed join. Today the
  // hardcoded now+1h clobbers it earlier.
  it('case 8 — a far-future window is never moved backward (RED today)', async () => {
    const now = new Date();
    const eventId = await createScheduledEvent({
      gameId: gameId(),
      start: minsFrom(now, -30),
      end: minsFrom(now, 30),
      extendedUntil: minsFrom(now, 90), // beyond now+1h
    });
    const before = await readEpochs(eventId);

    const suppressed = await service.trySuppressForScheduled(
      UNRELATED_BINDING,
      gameId(),
      undefined,
    );
    expect(suppressed).toBe(true);

    const after = await readEpochs(eventId);
    expect(after.extEpoch ?? 0).toBeGreaterThanOrEqual((before.extEpoch ?? 0) - 2);
  });

  // Case 9 — RED today: extended_until is capped at scheduledEnd + 6h. Event
  // ended 5.5h ago (ceiling now+30m) but is still found via its open window;
  // today the join pushes extended_until to now+1h, past the ceiling.
  it('case 9 — extension is capped at scheduledEnd + 6h (RED today)', async () => {
    const now = new Date();
    const eventId = await createScheduledEvent({
      gameId: gameId(),
      start: minsFrom(now, -360),
      end: minsFrom(now, -330), // ended 5.5h ago ⇒ ceiling = now+30m
      extendedUntil: minsFrom(now, 5), // open window keeps it "found"
    });

    const suppressed = await service.trySuppressForScheduled(
      UNRELATED_BINDING,
      gameId(),
      undefined,
    );
    expect(suppressed).toBe(true);

    const after = await readEpochs(eventId);
    expect(after.extEpoch).not.toBeNull();
    expect(after.extEpoch as number).toBeLessThanOrEqual(after.endEpoch + 6 * HOUR_S + 2);
  });

  // Case 11 — PIN (P-9, false-negative direction): the guard DOES write when
  // extended_until is genuinely stale — proving a "guard that never fires" is
  // distinguishable from correct behaviour.
  it('case 11 — the guard DOES extend a genuinely stale window', async () => {
    const now = new Date();
    const eventId = await createScheduledEvent({
      gameId: gameId(),
      start: minsFrom(now, -10),
      end: minsFrom(now, 20), // live event
      extendedUntil: minsFrom(now, -10), // stale window (in the past)
    });
    const before = await readEpochs(eventId);
    const nowEpoch = Date.now() / 1000;

    const suppressed = await service.trySuppressForScheduled(
      UNRELATED_BINDING,
      gameId(),
      undefined,
    );
    expect(suppressed).toBe(true);

    const after = await readEpochs(eventId);
    expect(after.extEpoch).not.toBeNull();
    expect(after.extEpoch as number).toBeGreaterThan((before.extEpoch ?? 0) + 60);
    expect(after.extEpoch as number).toBeGreaterThan(nowEpoch);
  });
});
