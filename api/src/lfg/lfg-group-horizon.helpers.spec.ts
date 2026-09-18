/**
 * ROK-1455 walk feedback — the group's horizon is a property of the GROUP.
 *
 * The whole point of this module is that it never looks at one member: an
 * inviter on a week hand invites you into a group that is playing right now
 * the moment ANY live member holds a now hand. These tests pin the projection
 * and the `createIntent` argument; the SQL predicate itself is exercised
 * end-to-end by `lfg-invite-limits.integration.spec.ts`.
 */
import { desc } from 'drizzle-orm';
import * as schema from '../drizzle/schema';
import {
  horizonJoinRequest,
  readGroupHorizon,
} from './lfg-group-horizon.helpers';

type Row = Record<string, unknown>;

interface Recorder {
  orderBy: unknown[];
  limit: unknown[];
}

/** Drizzle stand-in that answers the one query this module issues. */
function fakeDb(rows: Row[], seen: Recorder) {
  const chain: Record<string, unknown> = {};
  Object.assign(chain, {
    from: () => chain,
    innerJoin: () => chain,
    where: () => chain,
    orderBy: (...args: unknown[]) => {
      seen.orderBy = args;
      return chain;
    },
    limit: (...args: unknown[]) => {
      seen.limit = args;
      return Promise.resolve(rows);
    },
  });
  return { select: () => chain } as never;
}

function recorder(): Recorder {
  return { orderBy: [], limit: [] };
}

/** How many `where` clauses one fake saw — i.e. how many queries were issued. */
interface QueryLog {
  count: number;
}

/**
 * Drizzle stand-in that answers each successive query with the next result
 * set, so precedence between the `now` lookup and the `tonight` one is
 * observable rather than assumed.
 */
function queuedDb(results: Row[][], log: QueryLog) {
  const chain: Record<string, unknown> = {};
  Object.assign(chain, {
    from: () => chain,
    innerJoin: () => chain,
    where: () => {
      log.count += 1;
      return chain;
    },
    orderBy: () => chain,
    limit: () => Promise.resolve(results[log.count - 1] ?? []),
  });
  return { select: () => chain } as never;
}

const NOW = new Date('2026-09-08T20:00:00.000Z');
const LAPSES_AT = new Date('2026-09-08T20:45:00.000Z');

describe('readGroupHorizon (ROK-1455 walk feedback 2)', () => {
  it('reports `week` when the group holds no live `now` hand', async () => {
    const horizon = await readGroupHorizon(fakeDb([], recorder()), 42, NOW);

    expect(horizon).toEqual({
      urgency: 'week',
      nowExpiresAt: null,
      ttlMinutes: null,
    });
  });

  it('reports `now` with the hand that runs LONGEST — its expiry and its TTL bucket', async () => {
    const seen = recorder();
    const db = fakeDb([{ expiresAt: LAPSES_AT, ttlMinutes: 60 }], seen);

    const horizon = await readGroupHorizon(db, 42, NOW);

    expect(horizon).toEqual({
      urgency: 'now',
      nowExpiresAt: LAPSES_AT,
      ttlMinutes: 60,
    });
    // Longest-running, not soonest: that is when the group stops being a now
    // group, so it is the honest "until" and the clock a joiner inherits.
    expect(seen.orderBy).toEqual([desc(schema.lfgIntents.expiresAt)]);
    expect(seen.limit).toEqual([1]);
  });

  it('falls back to the default bucket for a `now` row whose TTL is null', async () => {
    const db = fakeDb([{ expiresAt: LAPSES_AT, ttlMinutes: null }], recorder());

    await expect(readGroupHorizon(db, 42, NOW)).resolves.toMatchObject({
      urgency: 'now',
      ttlMinutes: 30,
    });
  });
});

describe('horizonJoinRequest (ROK-1455 walk feedback 3)', () => {
  it('asks for a `now` hand on the group’s own TTL bucket', () => {
    expect(
      horizonJoinRequest({
        urgency: 'now',
        nowExpiresAt: LAPSES_AT,
        ttlMinutes: 60,
      }),
    ).toEqual({ urgency: 'now', ttlMinutes: 60 });
  });

  it('asks for a `week` hand on a week group — never a now hand with no clock', () => {
    expect(
      horizonJoinRequest({
        urgency: 'week',
        nowExpiresAt: null,
        ttlMinutes: null,
      }),
    ).toEqual({ urgency: 'week' });
  });
});

describe('readGroupHorizon — three horizons, most urgent wins (ROK-1616 AC6)', () => {
  const TONIGHT_AT = new Date('2026-09-09T08:00:00.000Z');

  it('reports `tonight` — with NO ttl — when only a tonight hand is live', async () => {
    const log = { count: 0 };
    const db = queuedDb([[], [{ expiresAt: TONIGHT_AT, ttlMinutes: null }]], log);

    await expect(readGroupHorizon(db, 42, NOW)).resolves.toEqual({
      urgency: 'tonight',
      nowExpiresAt: TONIGHT_AT,
      // A tonight group has no TTL bucket; reporting one would hand a joiner a
      // 30-minute clock on a six-hour group.
      ttlMinutes: null,
    });
    expect(log.count).toBe(2);
  });

  it('a MIXED group is a `now` group — the tonight hand is never even queried', async () => {
    const log = { count: 0 };
    // Query 1 (now) finds a hand; query 2 (tonight) would find one too, and
    // must never run — the group IS playing right now.
    const db = queuedDb(
      [
        [{ expiresAt: LAPSES_AT, ttlMinutes: 60 }],
        [{ expiresAt: TONIGHT_AT, ttlMinutes: null }],
      ],
      log,
    );

    await expect(readGroupHorizon(db, 42, NOW)).resolves.toEqual({
      urgency: 'now',
      nowExpiresAt: LAPSES_AT,
      ttlMinutes: 60,
    });
    expect(log.count).toBe(1);
  });

  it('AC7: a stored now/60 row keeps its class and its TTL — it never becomes tonight', async () => {
    const log = { count: 0 };
    const db = queuedDb([[{ expiresAt: LAPSES_AT, ttlMinutes: 60 }]], log);

    const horizon = await readGroupHorizon(db, 42, NOW);

    expect(horizon.urgency).toBe('now');
    expect(horizon.ttlMinutes).toBe(60);
    expect(horizon.nowExpiresAt).toEqual(LAPSES_AT);
  });

  it('still reports `week` when neither class has a live hand', async () => {
    const log = { count: 0 };

    await expect(readGroupHorizon(queuedDb([[], []], log), 42, NOW)).resolves.toEqual({
      urgency: 'week',
      nowExpiresAt: null,
      ttlMinutes: null,
    });
    expect(log.count).toBe(2);
  });
});

describe('horizonJoinRequest — tonight (ROK-1616 AC6)', () => {
  it('asks for a tonight hand with NO ttl and NO copied expiry', () => {
    const request = horizonJoinRequest({
      urgency: 'tonight',
      nowExpiresAt: new Date('2026-09-09T08:00:00.000Z'),
      ttlMinutes: null,
    });

    // `resolveIntentHorizon` recomputes 04:00 from the join instant; copying
    // the group's `expires_at` is what would let a joiner inherit an expiry in
    // the past.
    expect(request).toEqual({ urgency: 'tonight' });
    expect(request).not.toHaveProperty('expiresAt');
  });
});
