/**
 * Integration tests for ROK-1352 ephemeral-voice DB paths (real Postgres).
 *
 * Covers (per spec Test Strategy):
 *  - create-window candidate scan (in-window, no channel, not cancelled)
 *  - reaper candidate scan (past idle window, has channel)
 *  - resolver Tier 0 (ephemeral channel wins over all bindings)
 *  - attendance attach by ephemeral channel id (AC5)
 *  - bounds read back as ISO-Z instants, and every scan compares on the UTC
 *    wall clock even when the DB session zone is not UTC
 */
import { sql } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import { truncateAllTables } from '../../common/testing/integration-helpers';
import * as schema from '../../drizzle/schema';
import {
  findCreateCandidates,
  findReapCandidates,
  findNameReconcileCandidates,
  findEventByEphemeralChannel,
} from './ephemeral-voice.db-helpers';
import { findActiveEventsByEphemeralChannel } from './voice-attendance-ephemeral.helpers';
import { loadLfgNowEphemeralRow } from '../lfg-now/lfg-now.db-helpers';

describe('ephemeral-voice DB integration (ROK-1352)', () => {
  let app: TestApp;

  beforeAll(async () => {
    app = await getTestApp();
  });

  afterEach(async () => {
    app.seed = await truncateAllTables(app.db);
  });

  async function insertEvent(opts: {
    startOffsetMin: number;
    endOffsetMin: number;
    channelId?: string | null;
    enabled?: boolean | null;
    cancelled?: boolean;
    recurrenceGroupId?: string | null;
  }): Promise<number> {
    const start = new Date(Date.now() + opts.startOffsetMin * 60_000);
    const end = new Date(Date.now() + opts.endOffsetMin * 60_000);
    const [row] = await app.db
      .insert(schema.events)
      .values({
        title: 'Ephemeral Test',
        creatorId: app.seed.adminUser.id,
        gameId: app.seed.game.id,
        duration: [start, end],
        ephemeralVoiceChannelId: opts.channelId ?? null,
        ephemeralVoiceEnabled: opts.enabled ?? null,
        recurrenceGroupId: opts.recurrenceGroupId ?? null,
        cancelledAt: opts.cancelled ? new Date() : null,
      } as never)
      .returning({ id: schema.events.id });
    return row.id;
  }

  it('create-window scan returns only in-window, channel-less, live events', async () => {
    const inWindow = await insertEvent({
      startOffsetMin: 10,
      endOffsetMin: 70,
    });
    await insertEvent({ startOffsetMin: 120, endOffsetMin: 180 }); // too far out
    await insertEvent({
      startOffsetMin: 10,
      endOffsetMin: 70,
      channelId: 'ch-existing',
    }); // already has a channel
    await insertEvent({
      startOffsetMin: 10,
      endOffsetMin: 70,
      cancelled: true,
    }); // cancelled

    const ids = (
      await findCreateCandidates(app.db, new Date(), 30 * 60_000)
    ).map((e) => e.id);
    expect(ids).toEqual([inWindow]);
  });

  it('reaper scan returns events past the idle window that still hold a channel', async () => {
    const stale = await insertEvent({
      startOffsetMin: -180,
      endOffsetMin: -120,
      channelId: 'ch-stale',
    });
    await insertEvent({
      startOffsetMin: -180,
      endOffsetMin: -10,
      channelId: 'ch-recent',
    }); // ended only 10 min ago < 30 idle
    await insertEvent({ startOffsetMin: -180, endOffsetMin: -120 }); // no channel

    const ids = (await findReapCandidates(app.db, new Date(), 30 * 60_000)).map(
      (e) => e.id,
    );
    expect(ids).toEqual([stale]);
  });

  it('name-reconcile scan returns only in-flight events that hold a channel', async () => {
    const active = await insertEvent({
      startOffsetMin: -5,
      endOffsetMin: 55,
      channelId: 'ch-live',
    });
    await insertEvent({
      startOffsetMin: -180,
      endOffsetMin: -120,
      channelId: 'ch-ended',
    }); // already ended → leave to the reaper
    await insertEvent({ startOffsetMin: 10, endOffsetMin: 70 }); // no channel
    await insertEvent({
      startOffsetMin: 10,
      endOffsetMin: 70,
      channelId: 'ch-cancelled',
      cancelled: true,
    }); // cancelled

    const ids = (await findNameReconcileCandidates(app.db, new Date())).map(
      (e) => e.id,
    );
    expect(ids).toEqual([active]);
  });

  it('findEventByEphemeralChannel resolves the owning event', async () => {
    const id = await insertEvent({
      startOffsetMin: 10,
      endOffsetMin: 70,
      channelId: 'ch-owned',
    });
    const row = await findEventByEphemeralChannel(app.db, 'ch-owned');
    expect(row?.id).toBe(id);
    expect(await findEventByEphemeralChannel(app.db, 'nope')).toBeNull();
  });

  it('attendance attach matches an active event by ephemeral channel id (AC5)', async () => {
    const active = await insertEvent({
      startOffsetMin: -5,
      endOffsetMin: 55,
      channelId: 'ch-active',
    });
    await insertEvent({
      startOffsetMin: -180,
      endOffsetMin: -120,
      channelId: 'ch-ended',
    }); // past end → not active

    const hits = await findActiveEventsByEphemeralChannel(
      app.db,
      'ch-active',
      new Date(),
    );
    expect(hits.map((h) => h.eventId)).toEqual([active]);
    expect(
      await findActiveEventsByEphemeralChannel(app.db, 'ch-ended', new Date()),
    ).toEqual([]);
  });

  const ISO_Z = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
  const START = new Date('2026-07-02T22:15:30.123Z');
  const END = new Date('2026-07-02T23:45:10.456Z');
  const EXTENDED = new Date('2026-07-03T00:20:05.789Z');

  async function insertFixed(opts: {
    channelId: string;
    extendedUntil?: Date;
    isAdHoc?: boolean;
  }): Promise<number> {
    const [row] = await app.db
      .insert(schema.events)
      .values({
        title: 'Ephemeral Bounds',
        creatorId: app.seed.adminUser.id,
        gameId: app.seed.game.id,
        duration: [START, END],
        ephemeralVoiceChannelId: opts.channelId,
        extendedUntil: opts.extendedUntil ?? null,
        isAdHoc: opts.isAdHoc ?? false,
        channelBindingId: null,
      } as never)
      .returning({ id: schema.events.id });
    if (!row) throw new Error('event insert returned no row');
    return row.id;
  }

  /** The zone-less bounds must come back as instants: ISO-8601 with a `Z`. */
  function expectBounds(
    row: { startTime: string; endTime: string } | null,
    start: Date,
    end: Date,
  ): void {
    expect(row).not.toBeNull();
    expect(row?.startTime).toMatch(ISO_Z);
    expect(row?.endTime).toMatch(ISO_Z);
    expect(new Date(row?.startTime ?? '').getTime()).toBe(start.getTime());
    expect(new Date(row?.endTime ?? '').getTime()).toBe(end.getTime());
  }

  it('findEventByEphemeralChannel returns ISO-Z bounds equal to the seeded instants', async () => {
    await insertFixed({ channelId: 'ch-bounds' });
    await insertFixed({ channelId: 'ch-extended', extendedUntil: EXTENDED });
    expectBounds(
      await findEventByEphemeralChannel(app.db, 'ch-bounds'),
      START,
      END,
    );
    expectBounds(
      await findEventByEphemeralChannel(app.db, 'ch-extended'),
      START,
      EXTENDED,
    );
  });

  it('loadLfgNowEphemeralRow returns ISO-Z bounds for an LFG-born event', async () => {
    const id = await insertFixed({
      channelId: 'ch-lfg',
      extendedUntil: EXTENDED,
      isAdHoc: true,
    });
    expectBounds(await loadLfgNowEphemeralRow(app.db, id), START, EXTENDED);
  });

  /** Run `fn` in a transaction whose session zone is NOT UTC. */
  async function inNewYorkSession<T>(
    fn: (db: typeof app.db) => Promise<T>,
  ): Promise<T> {
    return app.db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL TIME ZONE 'America/New_York'`);
      return fn(tx);
    });
  }

  // The bounds are zone-less UTC. A `::timestamptz` compare reads them in the
  // session zone, shifting each by its offset (4-5h here), so these fail on
  // any host if a scan stops pinning the UTC wall clock.
  it('reaper scan reads the effective end as UTC under a non-UTC session', async () => {
    const stale = await insertEvent({
      startOffsetMin: -180,
      endOffsetMin: -120,
      channelId: 'ch-tz-stale',
    });
    const ids = await inNewYorkSession(async (db) =>
      (await findReapCandidates(db, new Date(), 30 * 60_000)).map((e) => e.id),
    );
    expect(ids).toEqual([stale]);
  });

  it('create scan reads the start as UTC under a non-UTC session', async () => {
    const soon = await insertEvent({ startOffsetMin: 10, endOffsetMin: 70 });
    const ids = await inNewYorkSession(async (db) =>
      (await findCreateCandidates(db, new Date(), 30 * 60_000)).map(
        (e) => e.id,
      ),
    );
    expect(ids).toEqual([soon]);
  });

  it('attendance attach matches only the active ephemeral event under a non-UTC session', async () => {
    const active = await insertEvent({
      startOffsetMin: -5,
      endOffsetMin: 55,
      channelId: 'ch-tz-attach-active',
    });
    await insertEvent({
      startOffsetMin: -180,
      endOffsetMin: -120,
      channelId: 'ch-tz-attach-ended',
    });
    const hits = await inNewYorkSession(async (db) => ({
      active: (
        await findActiveEventsByEphemeralChannel(
          db,
          'ch-tz-attach-active',
          new Date(),
        )
      ).map((h) => h.eventId),
      ended: (
        await findActiveEventsByEphemeralChannel(
          db,
          'ch-tz-attach-ended',
          new Date(),
        )
      ).map((h) => h.eventId),
    }));
    expect(hits).toEqual({ active: [active], ended: [] });
  });

  it('name-reconcile scan skips an ended event under a non-UTC session', async () => {
    const live = await insertEvent({
      startOffsetMin: -5,
      endOffsetMin: 55,
      channelId: 'ch-tz-live',
    });
    await insertEvent({
      startOffsetMin: -180,
      endOffsetMin: -120,
      channelId: 'ch-tz-ended',
    });
    const ids = await inNewYorkSession(async (db) =>
      (await findNameReconcileCandidates(db, new Date())).map((e) => e.id),
    );
    expect(ids).toEqual([live]);
  });
});
