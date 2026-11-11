/**
 * ROK-1727 — the guarded upsert set: a slower, lower-ranked outcome never
 * replaces better stored metadata (Codex MEDIUM). Renders the SQL to prove
 * which stored statuses each incoming outcome protects; the real-DB proof is
 * in wowhead-item-meta.integration.spec.ts.
 */
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { conflictSet } from './wow-item-meta.upsert';
import type { WowItemMetaInsert } from './wowhead-item.types';

const NOW = new Date('2026-10-09T12:00:00Z');
const dialect = new PgDialect();
/** Content columns guarded by the CASE; tooltip since ROK-2176. */
const CONTENT_COLS = ['status', 'env', 'name', 'quality', 'icon', 'tooltip'];

function insert(over: Partial<WowItemMetaInsert>): WowItemMetaInsert {
  return {
    itemId: 1,
    status: 'not_found',
    env: null,
    name: null,
    quality: null,
    icon: null,
    fetchedAt: NOW,
    nextRetryAt: NOW,
    attempts: 0,
    ...over,
  };
}

/** Stored statuses for which the CASE keeps the stored value. */
function protectedStatuses(expr: unknown): unknown[] {
  return dialect.sqlToQuery(expr as SQL).params;
}

describe('conflictSet (ROK-1727)', () => {
  it('not_found arriving: a stored resolved / classic_fallback row keeps its data', () => {
    const set = conflictSet(insert({ status: 'not_found' }));
    const q = dialect.sqlToQuery(set.status as SQL).sql;
    expect(q).toMatch(
      /^CASE WHEN .*"status" IN \(\$1, \$2\) THEN .*"status" ELSE excluded\."status" END$/,
    );
    for (const col of CONTENT_COLS) {
      expect(protectedStatuses(set[col])).toEqual([
        'resolved',
        'classic_fallback',
      ]);
    }
    expect(set).toMatchObject({
      fetchedAt: NOW,
      nextRetryAt: NOW,
      attempts: 0,
    });
  });

  it('classic_fallback arriving: never downgrades resolved, replaces an older fallback', () => {
    const set = conflictSet(
      insert({ status: 'classic_fallback', env: 4, name: 'Old' }),
    );
    for (const col of CONTENT_COLS) {
      expect(protectedStatuses(set[col])).toEqual(['resolved']);
    }
  });

  // Review MAJOR 1: the parser version is "probed by vN", not content — a
  // lower-ranked outcome stamps it even where the tooltip stays protected.
  it.each(['not_found', 'classic_fallback'] as const)(
    '%s arriving: stamps tooltipVersion unguarded, tooltip stays guarded',
    (status) => {
      const set = conflictSet(insert({ status, tooltipVersion: 1 }));
      expect(set.tooltipVersion).toBe(1);
      expect(protectedStatuses(set.tooltip)).not.toEqual([]);
    },
  );

  it('resolved arriving: unconditional — upgrades a classic_fallback in place', () => {
    const row = insert({
      status: 'resolved',
      env: 16,
      name: 'Thunderfury',
      tooltip: null,
      tooltipVersion: 1,
    });
    expect(conflictSet(row)).toEqual({
      fetchedAt: NOW,
      nextRetryAt: NOW,
      attempts: 0,
      status: 'resolved',
      env: 16,
      name: 'Thunderfury',
      quality: null,
      icon: null,
      tooltip: null,
      tooltipVersion: 1,
    });
  });

  it('error arriving: bookkeeping only — never touches the tooltip', () => {
    const row = insert({ status: 'error', attempts: 2, tooltipVersion: 1 });
    expect(conflictSet(row)).toEqual({
      fetchedAt: NOW,
      nextRetryAt: NOW,
      attempts: 2,
    });
  });
});
