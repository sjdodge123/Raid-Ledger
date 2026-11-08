/**
 * ROK-2125: an import whose `quests` has no `completed` key must not wipe the
 * completed list already stored. The carry runs INSIDE the conflict update
 * (review r1: atomic — no read-then-write window), so the unit tier checks
 * when it applies and the SQL it renders; the integration spec
 * `character-quests.log-only-import.integration.spec.ts` proves the result.
 */
import type { AddonCharSnapshotData } from '@raid-ledger/contract';
import { PgDialect } from 'drizzle-orm/pg-core';
import { characterAddonSnapshots } from '../../../drizzle/schema';
import {
  carriedCompletedDataSql,
  needsCompletedCarry,
} from './addon-import-char.quests-carry';

const LOG = [{ questId: 9 }];

function incoming(
  quests: AddonCharSnapshotData['quests'],
): AddonCharSnapshotData {
  const base: AddonCharSnapshotData = {
    gear: [],
    talents: { nodes: [] },
    lockouts: [],
  };
  return quests ? { ...base, quests } : base;
}

describe('needsCompletedCarry (ROK-2125)', () => {
  it('is true for a quests slice without `completed`, a stray flag included', () => {
    expect(needsCompletedCarry(incoming({ inProgress: LOG }))).toBe(true);
    expect(
      needsCompletedCarry(
        incoming({ inProgress: LOG, completedTruncated: true }),
      ),
    ).toBe(true);
  });

  it('is false for an explicit list — an empty list included', () => {
    for (const completed of [[], [7]]) {
      expect(
        needsCompletedCarry(incoming({ completed, inProgress: LOG })),
      ).toBe(false);
    }
  });

  it('is false for an import with no quests slice at all', () => {
    expect(needsCompletedCarry(incoming(undefined))).toBe(false);
  });
});

describe('carriedCompletedDataSql (ROK-2125 review r1)', () => {
  const { sql: text, params } = new PgDialect().sqlToQuery(
    carriedCompletedDataSql(characterAddonSnapshots.data),
  );
  const stored = '"character_addon_snapshots"."data"';

  it('is one expression over the existing row and `excluded` — no bound values', () => {
    expect(params).toEqual([]);
    expect(text).toContain(
      `jsonb_typeof(${stored} -> 'quests' -> 'completed') = 'array'`,
    );
    expect(text).toContain('ELSE excluded.data END');
  });

  it('carries the stored list and the STORED truncation flag, never the incoming flag', () => {
    expect(text).toContain(`'completed', ${stored} -> 'quests' -> 'completed'`);
    expect(text).toContain(
      "(excluded.data -> 'quests') - 'completedTruncated'",
    );
    expect(text).toContain(
      `${stored} -> 'quests' -> 'completedTruncated' = 'true'::jsonb`,
    );
  });
});
