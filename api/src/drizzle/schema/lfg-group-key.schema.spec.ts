/**
 * ROK-2352 — the opaque `group_key` shape guard.
 *
 * A group is `(game_id, group_key)`; `''` is the whole-game group, so every
 * non-WoW game keeps today's identity exactly. Each assertion pins an
 * invariant whose silent loss would break that:
 *
 *  - `group_key` is NOT NULL with a default. NULLs never collide in a unique
 *    index, so a nullable key would drop the one-live-hand-per-user+game
 *    guarantee for every non-WoW game.
 *  - the live-hand unique index and the group-count index key on
 *    `(…, game_id, group_key)` and stay PARTIAL on `status = 'active'`.
 *  - both invite indexes gain `group_key` right after `game_id`.
 *  - the plugin table `wow_lfg_hand_details` cascades with its hand, keeps a
 *    character pick only while the character exists, and indexes that FK.
 */
import { getTableConfig, PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { lfgIntents } from './lfg-intents';
import { lfgInvites } from './lfg-invites';
import { wowLfgHandDetails } from './wow-lfg-hand-details';
import { defined } from '../../common/testing/narrow';

type Config = ReturnType<typeof getTableConfig>;

/** Compile a drizzle condition to the SQL text Postgres would actually see. */
function compile(node: SQL | undefined): string {
  if (!node) return '';
  return new PgDialect().sqlToQuery(node).sql;
}

/** Column names of the named index, or undefined when the index is missing. */
function indexColumns(config: Config, name: string): string[] | undefined {
  const idx = config.indexes.find((i) => i.config.name === name);
  return idx?.config.columns.map((c) => (c as { name: string }).name);
}

/** The compiled WHERE of the named index. */
function indexWhere(config: Config, name: string): string {
  const idx = config.indexes.find((i) => i.config.name === name);
  return compile(idx?.config.where);
}

/** Asserts a `group_key text NOT NULL DEFAULT ''` column. */
function expectGroupKeyColumn(config: Config): void {
  const column = config.columns.find((c) => c.name === 'group_key');
  expect(column?.getSQLType()).toBe('text');
  expect(column?.notNull).toBe(true);
  expect(column?.default).toBe('');
}

describe('lfg_intents group_key (ROK-2352)', () => {
  const config = getTableConfig(lfgIntents);

  it("stores group_key as text NOT NULL DEFAULT ''", () => {
    expectGroupKeyColumn(config);
  });

  it('allows one live hand per (user, game, group)', () => {
    const name = 'uq_lfg_intents_user_game_group_active';
    const idx = config.indexes.find((i) => i.config.name === name);
    expect(idx?.config.unique).toBe(true);
    expect(indexColumns(config, name)).toEqual([
      'user_id',
      'game_id',
      'group_key',
    ]);
    expect(indexWhere(config, name)).toBe(
      '"lfg_intents"."status" = \'active\'',
    );
  });

  it('counts live hands per (game, group)', () => {
    const name = 'idx_lfg_intents_game_group_active';
    expect(indexColumns(config, name)).toEqual(['game_id', 'group_key']);
    expect(indexWhere(config, name)).toBe(
      '"lfg_intents"."status" = \'active\'',
    );
  });

  it('drops the per-game indexes the group indexes replace', () => {
    expect(
      indexColumns(config, 'uq_lfg_intents_user_game_active'),
    ).toBeUndefined();
    expect(indexColumns(config, 'idx_lfg_intents_game_active')).toBeUndefined();
  });

  it("CHECKs the key grammar: '' or <kind>:<id>", () => {
    const check = config.checks.find(
      (c) => c.name === 'lfg_intents_group_key_check',
    );
    const text = compile(check?.value);
    expect(text).toContain('"lfg_intents"."group_key" = \'\'');
    expect(text).toContain("'^[a-z][a-z0-9_-]{0,31}:[A-Za-z0-9:_-]{1,64}$'");
  });
});

describe('lfg_invites group_key (ROK-2352)', () => {
  const config = getTableConfig(lfgInvites);

  it("stores group_key as text NOT NULL DEFAULT ''", () => {
    expectGroupKeyColumn(config);
  });

  it('keys the per-group cap on (game, group, sent_at)', () => {
    expect(indexColumns(config, 'idx_lfg_invites_game_group_sent_at')).toEqual([
      'game_id',
      'group_key',
      'sent_at',
    ]);
  });

  it('keys the no-repeat read on (recipient, game, group, sent_at)', () => {
    expect(
      indexColumns(config, 'idx_lfg_invites_recipient_game_group_sent_at'),
    ).toEqual(['recipient_user_id', 'game_id', 'group_key', 'sent_at']);
  });

  it('drops the per-game invite indexes', () => {
    expect(
      indexColumns(config, 'idx_lfg_invites_game_sent_at'),
    ).toBeUndefined();
    expect(
      indexColumns(config, 'idx_lfg_invites_recipient_game_sent_at'),
    ).toBeUndefined();
  });
});

describe('wow_lfg_hand_details (ROK-2352 plugin table)', () => {
  const config = getTableConfig(wowLfgHandDetails);
  const fk = (column: string) =>
    config.foreignKeys.find((f) =>
      f.reference().columns.some((c) => c.name === column),
    );

  it('is keyed by the hand and dies with it', () => {
    const intentId = config.columns.find((c) => c.name === 'intent_id');
    expect(intentId?.primary).toBe(true);
    expect(fk('intent_id')?.onDelete).toBe('cascade');
    const parent = defined(fk('intent_id'), 'intent_id FK').reference();
    expect(getTableConfig(parent.foreignTable).name).toBe('lfg_intents');
  });

  it('forgets a deleted character instead of losing the hand', () => {
    const column = config.columns.find((c) => c.name === 'character_id');
    expect(column?.notNull).toBe(false);
    expect(fk('character_id')?.onDelete).toBe('set null');
    expect(
      indexColumns(config, 'idx_wow_lfg_hand_details_character_id'),
    ).toEqual(['character_id']);
  });

  it('CHECKs roles: 1..3 of tank/healer/dps', () => {
    const check = config.checks.find(
      (c) => c.name === 'wow_lfg_hand_details_roles_check',
    );
    const text = compile(check?.value);
    expect(text).toContain("ARRAY['tank', 'healer', 'dps']");
    expect(text).toContain('between 1 and 3');
  });
});
