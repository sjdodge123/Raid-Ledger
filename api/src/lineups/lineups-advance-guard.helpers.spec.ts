/**
 * ROK-1710 (Codex P2) — an automatic advance is pinned to the target state it
 * judged. The end-to-end race lives in
 * `lineup-nomination-target-edit.integration.spec.ts`.
 */
import { PgDialect } from 'drizzle-orm/pg-core';
import {
  advanceGuardCondition,
  advanceGuardFrom,
} from './lineups-advance-guard.helpers';

function render(guard: Parameters<typeof advanceGuardCondition>[0]) {
  const cond = advanceGuardCondition(guard);
  if (!cond) throw new Error('expected a guard condition');
  return new PgDialect().sqlToQuery(cond);
}

describe('advanceGuardFrom', () => {
  it('captures the judged target, disarm stamp, grace claim and arm of a building row', () => {
    const claim = new Date('2026-11-27T10:00:00Z');
    const armed = new Date('2026-11-27T09:00:00Z');
    expect(
      advanceGuardFrom({
        status: 'building',
        nominationTargetPct: 50,
        nominationTargetDisarmedAt: null,
        pendingAdvanceAt: claim,
        nominationTargetBelowSeenAt: armed,
      }),
    ).toEqual({
      nominationTargetPct: 50,
      nominationTargetDisarmedAt: null,
      pendingAdvanceAt: claim,
      nominationTargetBelowSeenAt: armed,
    });
  });

  it('leaves voting -> decided on its status-only predicate', () => {
    expect(
      advanceGuardFrom({
        status: 'voting',
        nominationTargetPct: 50,
        nominationTargetDisarmedAt: null,
        pendingAdvanceAt: new Date(),
        nominationTargetBelowSeenAt: null,
      }),
    ).toBeUndefined();
  });
});

describe('advanceGuardCondition', () => {
  it('a grace advance requires the judged pct and the judged claim deadline', () => {
    const claim = new Date('2026-11-27T10:00:00Z');
    const where = render({
      nominationTargetPct: 50,
      nominationTargetDisarmedAt: null,
      pendingAdvanceAt: claim,
      nominationTargetBelowSeenAt: null,
    });
    // An edit rewrites the pct and nulls the claim, so the stale advance
    // matches no row.
    expect(where.sql).toMatch(/"nomination_target_pct" = \$\d/);
    expect(where.sql).toMatch(/"nomination_target_disarmed_at" is null/);
    expect(where.sql).toMatch(/"pending_advance_at" = \$\d/);
    expect(where.params).toContain(50);
  });

  it('a zero-grace advance on a deadline-only lineup requires both to still be null', () => {
    const where = render({
      nominationTargetPct: null,
      nominationTargetDisarmedAt: null,
      pendingAdvanceAt: null,
      nominationTargetBelowSeenAt: null,
    });
    expect(where.sql).toMatch(/"nomination_target_pct" is null/);
    expect(where.sql).toMatch(/"pending_advance_at" is null/);
    // Unarmed snapshot: its own predicate may arm while judging, so the arm
    // stamp is left unconstrained.
    expect(where.sql).not.toMatch(/"nomination_target_below_seen_at"/);
  });

  it('a target-driven advance requires the arm stamp it judged (Codex round 4 ABA)', () => {
    const armed = new Date('2026-11-27T09:00:00Z');
    const where = render({
      nominationTargetPct: 50,
      nominationTargetDisarmedAt: null,
      pendingAdvanceAt: null,
      nominationTargetBelowSeenAt: armed,
    });
    expect(where.sql).toMatch(/"nomination_target_below_seen_at" = \$\d/);
    const pinsArm = where.params.some((v) =>
      v instanceof Date
        ? v.getTime() === armed.getTime()
        : String(v).startsWith('2026-11-27T09:00:00'),
    );
    expect(pinsArm).toBe(true);
  });
});
