/**
 * Integration tests for ROK-1352 ephemeral-voice DB paths (real Postgres).
 *
 * Covers (per spec Test Strategy):
 *  - gate resolution via fetchSeriesEphemeralEnabled (series opt-in)
 *  - create-window candidate scan (in-window, no channel, not cancelled)
 *  - reaper candidate scan (past idle window, has channel)
 *  - resolver Tier 0 (ephemeral channel wins over all bindings)
 *  - attendance attach by ephemeral channel id (AC5)
 */
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import { truncateAllTables } from '../../common/testing/integration-helpers';
import * as schema from '../../drizzle/schema';
import { randomUUID } from 'crypto';
import {
  findCreateCandidates,
  findReapCandidates,
  findEventByEphemeralChannel,
} from './ephemeral-voice.db-helpers';
import { fetchSeriesEphemeralEnabled } from './ephemeral-voice.gate.helpers';
import { findActiveEventsByEphemeralChannel } from './voice-attendance-ephemeral.helpers';

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

  it('fetchSeriesEphemeralEnabled reflects the series settings row', async () => {
    const rg = randomUUID();
    expect(await fetchSeriesEphemeralEnabled(app.db, rg)).toBe(false);
    await app.db
      .insert(schema.eventSeriesSettings)
      .values({ recurrenceGroupId: rg, ephemeralVoiceEnabled: true });
    expect(await fetchSeriesEphemeralEnabled(app.db, rg)).toBe(true);
    expect(await fetchSeriesEphemeralEnabled(app.db, null)).toBe(false);
  });

  it('create-window scan returns only in-window, channel-less, live events', async () => {
    const inWindow = await insertEvent({ startOffsetMin: 10, endOffsetMin: 70 });
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

    const ids = (
      await findReapCandidates(app.db, new Date(), 30 * 60_000)
    ).map((e) => e.id);
    expect(ids).toEqual([stale]);
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
});
