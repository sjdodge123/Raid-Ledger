/**
 * Unit tests for the dedup FK reassignment helpers (TDB:229 / TDB:254).
 *
 * `channel_bindings` carries a PARTIAL unique index,
 * `channel_bindings_nonseries_game_unique` on
 * (guild_id, channel_id, binding_purpose, game_id)
 * WHERE recurrence_group_id IS NULL AND game_id IS NOT NULL. When both the
 * winner and the loser are bound to the same channel for the same purpose, the
 * plain reassign UPDATE violates it. Under postgres.js a failed statement
 * poisons the whole transaction (savepoints included), so the merge aborts at
 * commit. The collision must be PREVENTED: the loser's colliding row is deleted
 * (the winner's binding is kept) before the UPDATE runs.
 */
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { reassignMiscFks, type Tx } from './igdb-dedup-fk-reassign.helpers';

const dialect = new PgDialect();

/** Run reassignMiscFks against a tx that records every statement's SQL text. */
async function recordStatements(loserId: number, winnerId: number) {
  const statements: string[] = [];
  const tx = {
    execute: jest.fn((query: SQL) => {
      statements.push(dialect.sqlToQuery(query).sql.replace(/\s+/g, ' '));
      return Promise.resolve([]);
    }),
  };
  await reassignMiscFks(tx as unknown as Tx, loserId, winnerId);
  return statements;
}

function indexOfMatch(statements: string[], pattern: RegExp): number {
  return statements.findIndex((s) => pattern.test(s));
}

describe('reassignMiscFks — channel_bindings partial-unique collision', () => {
  const LOSER = 11;
  const WINNER = 22;

  it('deletes the loser binding that collides with the winner before the reassign UPDATE', async () => {
    const statements = await recordStatements(LOSER, WINNER);

    const deleteIdx = indexOfMatch(
      statements,
      /^DELETE FROM channel_bindings AS l USING channel_bindings AS w /,
    );
    const updateIdx = indexOfMatch(
      statements,
      /^UPDATE channel_bindings SET game_id = 22 WHERE game_id = 11$/,
    );

    expect({ deleteIdx: deleteIdx >= 0, updateIdx: updateIdx >= 0 }).toEqual({
      deleteIdx: true,
      updateIdx: true,
    });
    expect(deleteIdx).toBeLessThan(updateIdx);
  });

  it('scopes the pre-delete to exactly the partial index key and predicate', async () => {
    const statements = await recordStatements(LOSER, WINNER);
    const del = statements.find((s) =>
      s.startsWith('DELETE FROM channel_bindings AS l'),
    );

    expect(del).toBeDefined();
    // Only the LOSER's row goes; the winner's binding is the one kept.
    expect(del).toContain('l.game_id = 11');
    expect(del).toContain('w.game_id = 22');
    // Index key columns (game_id aside) must all match.
    expect(del).toContain('l.guild_id = w.guild_id');
    expect(del).toContain('l.channel_id = w.channel_id');
    expect(del).toContain('l.binding_purpose = w.binding_purpose');
    // Partial predicate on BOTH sides: series rows are governed by a
    // different index and never collide on game_id.
    expect(del).toContain('l.recurrence_group_id IS NULL');
    expect(del).toContain('w.recurrence_group_id IS NULL');
  });
});
