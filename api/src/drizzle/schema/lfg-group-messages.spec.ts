/**
 * ROK-1454 D4 — `lfg_group_messages` shape guard.
 *
 * The assertions here are deliberately NOT a restatement of the column list.
 * Each one pins an invariant that, if it silently changed, would either wedge
 * the feature permanently or corrupt the terminal render:
 *
 *  - the unique index MUST be PARTIAL on `state = 'open'`. A non-partial unique
 *    on `game_id` means a game can post exactly ONE LFM message in its entire
 *    life — every later group is rejected by the index (D4/D9's wedge class).
 *  - the `state` CHECK must enumerate all four states; a missing one makes the
 *    terminal write throw at close time, leaving an `open` row forever.
 *  - `last_member_count` must be NOT NULL with a default, because D6's EXPIRED
 *    render reads it and there is no roster to fall back on.
 *  - the games FK must be explicitly named and CASCADE.
 */
import { getTableConfig, PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { lfgGroupMessages } from './lfg-group-messages';

const PG_IDENTIFIER_LIMIT = 63;

/** Compile a drizzle condition to the SQL text Postgres would actually see. */
function compile(node: SQL | undefined): string {
  if (!node) return '';
  return new PgDialect().sqlToQuery(node).sql;
}

describe('lfg_group_messages schema (ROK-1454 D4)', () => {
  const config = getTableConfig(lfgGroupMessages);

  it('is the table D8 writes to', () => {
    expect(config.name).toBe('lfg_group_messages');
  });

  describe('the one-live-message-per-group invariant', () => {
    const openIndex = () =>
      config.indexes.find(
        (i) => i.config.name === 'uq_lfg_group_messages_game_open',
      );

    it('enforces uniqueness on game_id', () => {
      const idx = openIndex();
      expect(idx?.config.unique).toBe(true);
      expect(
        idx?.config.columns.map((c) => (c as { name: string }).name),
      ).toEqual(['game_id']);
    });

    it('is PARTIAL on state = open, so a closed group can post again', () => {
      const where = openIndex()?.config.where;
      expect(where).toBeDefined();
      expect(compile(where)).toBe('"lfg_group_messages"."state" = \'open\'');
    });
  });

  it('CHECKs state against exactly the four lifecycle values', () => {
    const check = config.checks.find(
      (c) => c.name === 'lfg_group_messages_state_check',
    );
    expect(check).toBeDefined();
    expect(compile(check?.value)).toBe(
      '"lfg_group_messages"."state" IN (\'open\', \'converted\', ' +
        "'expired', 'closed')",
    );
  });

  it('stores last_member_count NOT NULL so the EXPIRED render always has one', () => {
    const column = config.columns.find((c) => c.name === 'last_member_count');
    expect(column?.notNull).toBe(true);
    expect(column?.hasDefault).toBe(true);
  });

  it('names the games FK explicitly and within the 63-char Postgres limit', () => {
    const [fk] = config.foreignKeys;
    expect(fk).toBeDefined();
    const name = fk.getName();
    expect(name).toBe('lfg_group_messages_game_id_fk');
    expect(name.length).toBeLessThanOrEqual(PG_IDENTIFIER_LIMIT);
  });

  it('CASCADEs the games FK so a deleted game leaves no orphan message row', () => {
    expect(config.foreignKeys[0]?.onDelete).toBe('cascade');
  });

  it('indexes the Discord message coordinates for the edit path', () => {
    const idx = config.indexes.find(
      (i) => i.config.name === 'idx_lfg_group_messages_message',
    );
    expect(
      idx?.config.columns.map((c) => (c as { name: string }).name),
    ).toEqual(['guild_id', 'channel_id', 'message_id']);
  });
});
