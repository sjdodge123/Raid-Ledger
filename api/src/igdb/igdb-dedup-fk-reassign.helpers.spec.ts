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
import { Logger } from '@nestjs/common';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { reassignMiscFks, type Tx } from './igdb-dedup-fk-reassign.helpers';
import { reportCrossOwnerCharacterDeletes } from '../characters/characters-unique-keys.helpers';

const dialect = new PgDialect();

/** Run reassignMiscFks against a tx that records every statement's SQL text. */
async function recordStatements(
  loserId: number,
  winnerId: number,
  rowsFor: (statement: string) => unknown[] = () => [],
) {
  const statements: string[] = [];
  const tx = {
    execute: jest.fn((query: SQL) => {
      const text = dialect.sqlToQuery(query).sql.replace(/\s+/g, ' ').trim();
      statements.push(text);
      return Promise.resolve(rowsFor(text));
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

describe('reassignMiscFks — characters deleted from ANOTHER player (ROK-1721)', () => {
  const crossOwner = {
    loser_character_id: 'char-loser',
    loser_user_id: 5,
    winner_character_id: 'char-winner',
    winner_user_id: 9,
  };
  const isCrossOwnerSelect = (s: string) =>
    s.startsWith('SELECT DISTINCT ON (l.id)') &&
    s.includes('l.user_id <> w.user_id');

  afterEach(() => jest.restoreAllMocks());

  it('logs each cross-owner character the conflict-delete drops, with ids, before the DELETE', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const statements = await recordStatements(11, 22, (s) =>
      isCrossOwnerSelect(s) ? [crossOwner] : [],
    );

    expect(warn).toHaveBeenCalledWith({
      event: 'game_merge_cross_owner_character_delete',
      loserGameId: 11,
      winnerGameId: 22,
      loserCharacterId: 'char-loser',
      loserUserId: 5,
      winnerCharacterId: 'char-winner',
      winnerUserId: 9,
    });
    expect(warn).toHaveBeenCalledWith({
      event: 'game_merge_cross_owner_character_delete_count',
      loserGameId: 11,
      winnerGameId: 22,
      count: 1,
    });
    const selectIdx = statements.findIndex(isCrossOwnerSelect);
    const deleteIdx = indexOfMatch(
      statements,
      /^DELETE FROM characters AS l USING characters AS w /,
    );
    expect({ selectIdx: selectIdx >= 0, deleteIdx: deleteIdx >= 0 }).toEqual({
      selectIdx: true,
      deleteIdx: true,
    });
    expect(selectIdx).toBeLessThan(deleteIdx);
  });

  it('counts the cross-owner rows and stays quiet when there are none', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const tx = {
      execute: jest.fn(() => Promise.resolve([crossOwner, crossOwner])),
    };
    await expect(reportCrossOwnerCharacterDeletes(tx, 1, 2)).resolves.toBe(2);
    warn.mockClear();
    tx.execute.mockResolvedValueOnce([]);
    await expect(reportCrossOwnerCharacterDeletes(tx, 1, 2)).resolves.toBe(0);
    expect(warn).not.toHaveBeenCalled();
  });
});
