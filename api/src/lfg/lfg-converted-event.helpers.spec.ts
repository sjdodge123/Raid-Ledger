/**
 * ROK-1573 Lane B — unit coverage for `readConvertedEvent`.
 *
 * Pins the projection (DB row → `LfgConvertedEventDto`) and the predicate the
 * read filters on. The predicate is rendered through the real Postgres dialect
 * so a dropped clause (ad-hoc leak, cancelled leak, ended leak, provenance
 * leak) fails here, not only in the integration suite.
 */
import { PgDialect } from 'drizzle-orm/pg-core';
import {
  convertedEventWhere,
  readConvertedEvent,
} from './lfg-converted-event.helpers';
import type { LfgDb } from './lfg-query.helpers';
import { createDrizzleMock } from '../common/testing/drizzle-mock';

const STARTS_AT = new Date('2026-09-20T18:00:00.000Z');
const ENDS_AT = new Date('2026-09-20T20:00:00.000Z');
const NOW = new Date('2026-09-16T12:00:00.000Z');

/** One row as the single `readConvertedEvent` select returns it. */
function convertedRow(over: Record<string, unknown> = {}) {
  return {
    eventId: 501,
    title: 'Raid night',
    duration: [STARTS_AT, ENDS_AT] as [Date, Date],
    signupCount: 2,
    ...over,
  };
}

/** Render the predicate to SQL text + params with the real PG dialect. */
function renderWhere(gameId: number, now: Date) {
  const where = convertedEventWhere(gameId, now);
  if (!where) throw new Error('predicate must not be undefined');
  return new PgDialect().sqlToQuery(where);
}

describe('readConvertedEvent', () => {
  it('returns null when the game has no upcoming converted event', async () => {
    const db = createDrizzleMock();
    db.limit.mockResolvedValue([]);
    await expect(
      readConvertedEvent(db as unknown as LfgDb, 42, NOW),
    ).resolves.toBeNull();
  });

  it('projects the soonest converted event onto the wire DTO', async () => {
    const db = createDrizzleMock();
    db.limit.mockResolvedValue([convertedRow()]);
    await expect(
      readConvertedEvent(db as unknown as LfgDb, 42, NOW),
    ).resolves.toEqual({
      eventId: 501,
      title: 'Raid night',
      startTime: STARTS_AT.toISOString(),
      signupCount: 2,
    });
  });

  it('coerces a bigint-as-string count to a number', async () => {
    const db = createDrizzleMock();
    db.limit.mockResolvedValue([convertedRow({ signupCount: '3' })]);
    const result = await readConvertedEvent(db as unknown as LfgDb, 42, NOW);
    expect(result?.signupCount).toBe(3);
  });

  it('asks for exactly one row, soonest first', async () => {
    const db = createDrizzleMock();
    db.limit.mockResolvedValue([]);
    await readConvertedEvent(db as unknown as LfgDb, 42, NOW);
    expect(db.orderBy).toHaveBeenCalledTimes(1);
    expect(db.limit).toHaveBeenCalledWith(1);
  });
});

describe('convertedEventWhere', () => {
  it('scopes to the game and excludes ad-hoc and cancelled events', () => {
    const { sql, params } = renderWhere(42, NOW);
    expect(sql).toContain('"events"."game_id" = $');
    expect(params).toContain(42);
    expect(sql).toContain('"events"."is_ad_hoc" = $');
    expect(params).toContain(false);
    expect(sql).toContain('"events"."cancelled_at" is null');
  });

  it('keeps only events that have not ended as of `now`', () => {
    const { sql, params } = renderWhere(42, NOW);
    expect(sql).toMatch(/upper\("events"\."duration"\) > \$\d+::timestamp/);
    expect(params).toContain(NOW.toISOString());
  });

  it('requires LFG provenance — some intent points at the event', () => {
    const { sql } = renderWhere(42, NOW);
    expect(sql).toMatch(/exists \(\s*select 1 from lfg_intents/i);
    expect(sql).toContain('converted_to_event_id = "events"."id"');
  });
});
