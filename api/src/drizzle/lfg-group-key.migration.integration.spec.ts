/**
 * ROK-2352 AC2 — migration 0320 against OLD-shape data, real database.
 *
 * Inside one rolled-back transaction: put the three LFG tables back in their
 * pre-0320 shape (drop `group_key`, restore the per-game indexes), seed
 * old-shape rows with raw SQL (live/converted/expired hands, an open board
 * post, invites), run 0320's own statements read from the .sql file, then
 * assert every row landed in the whole-game group `''`, the live hand still
 * blocks a second `''` hand, and a `dungeon:36` hand for the same user+game is
 * accepted. The duplicate `''` insert is the LAST statement: a unique
 * violation poisons the transaction, and nothing after it could run.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sql, TransactionRollbackError, type SQL } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';

const MIGRATION = join(__dirname, 'migrations/0320_lfg_group_key.sql');

/** 0320's statements, verbatim — the spec and the migration share one text. */
const statements = readFileSync(MIGRATION, 'utf8')
  .split('--> statement-breakpoint')
  .map((s) => s.trim())
  .filter((s) => s.length > 0);

/** The pre-0320 shape: no group_key, per-game indexes. */
const OLD_SHAPE = [
  'ALTER TABLE "lfg_intents" DROP COLUMN "group_key"',
  'ALTER TABLE "lfg_invites" DROP COLUMN "group_key"',
  'ALTER TABLE "lfg_group_messages" DROP COLUMN "group_key"',
  `CREATE UNIQUE INDEX "uq_lfg_intents_user_game_active" ON "lfg_intents" ("user_id","game_id") WHERE "status" = 'active'`,
  `CREATE INDEX "idx_lfg_intents_game_active" ON "lfg_intents" ("game_id") WHERE "status" = 'active'`,
  'CREATE INDEX "idx_lfg_invites_game_sent_at" ON "lfg_invites" ("game_id","sent_at")',
  'CREATE INDEX "idx_lfg_invites_recipient_game_sent_at" ON "lfg_invites" ("recipient_user_id","game_id","sent_at")',
  `CREATE UNIQUE INDEX "uq_lfg_group_messages_game_open" ON "lfg_group_messages" ("game_id") WHERE "state" = 'open'`,
];

interface Outcome {
  keys: string[];
  dungeonHands: number;
  duplicateError: string;
}

let testApp: TestApp;

beforeAll(async () => {
  testApp = await getTestApp();
});

/** Postgres' error text, unwrapped from drizzle's "Failed query" wrapper. */
function pgMessage(err: unknown): string {
  if (err instanceof Error && err.cause instanceof Error) {
    return err.cause.message;
  }
  return String(err);
}

type Tx = Parameters<Parameters<TestApp['db']['transaction']>[0]>[0];

/** Runs a raw query and returns its rows. */
async function rows<T>(tx: Tx, query: SQL): Promise<T[]> {
  return (await tx.execute(query)) as unknown as T[];
}

/** Seeds old-shape rows; returns the ids the assertions need. */
async function seedOldShape(
  tx: Tx,
): Promise<{ userId: number; gameId: number }> {
  const users = await rows<{ id: number }>(
    tx,
    sql`INSERT INTO users (username) VALUES ('rok2352-a'), ('rok2352-b') RETURNING id`,
  );
  const [a, b] = users.map((u) => u.id);
  const games = await rows<{ id: number }>(
    tx,
    sql`INSERT INTO games (name, slug) VALUES ('ROK-2352 old shape', 'rok-2352-old-shape') RETURNING id`,
  );
  const gameId = games[0]?.id;
  if (a === undefined || b === undefined || gameId === undefined) {
    throw new Error('old-shape seed returned no ids');
  }
  await tx.execute(sql`
    INSERT INTO lfg_intents (user_id, game_id, status, expires_at) VALUES
      (${a}, ${gameId}, 'active', now() + interval '7 days'),
      (${a}, ${gameId}, 'converted', now() - interval '1 day'),
      (${b}, ${gameId}, 'expired', now() - interval '2 days')`);
  await tx.execute(sql`
    INSERT INTO lfg_group_messages (game_id, guild_id, channel_id, message_id, state)
    VALUES (${gameId}, 'g', 'c', 'm-open', 'open')`);
  await tx.execute(sql`
    INSERT INTO lfg_invites (recipient_user_id, inviter_user_id, game_id) VALUES
      (${b}, ${a}, ${gameId}), (${a}, ${b}, ${gameId})`);
  return { userId: a, gameId };
}

/** Every group_key across the three tables for the seeded game. */
async function collectKeys(tx: Tx, gameId: number): Promise<string[]> {
  const found = await rows<{ group_key: string }>(
    tx,
    sql`SELECT group_key FROM lfg_intents WHERE game_id = ${gameId}
        UNION ALL SELECT group_key FROM lfg_group_messages WHERE game_id = ${gameId}
        UNION ALL SELECT group_key FROM lfg_invites WHERE game_id = ${gameId}`,
  );
  return found.map((r) => r.group_key);
}

/** Old shape → seed → 0320 → assertions' raw material, all rolled back. */
async function migrateOldShape(): Promise<Outcome> {
  const outcome: Outcome = { keys: [], dungeonHands: 0, duplicateError: '' };
  try {
    await testApp.db.transaction(async (tx) => {
      for (const stmt of OLD_SHAPE) await tx.execute(sql.raw(stmt));
      const { userId, gameId } = await seedOldShape(tx);
      for (const stmt of statements) await tx.execute(sql.raw(stmt));
      outcome.keys = await collectKeys(tx, gameId);
      const dungeon = await rows<{ id: number }>(
        tx,
        sql`INSERT INTO lfg_intents (user_id, game_id, status, expires_at, group_key)
            VALUES (${userId}, ${gameId}, 'active', now() + interval '1 hour', 'dungeon:36')
            RETURNING id`,
      );
      outcome.dungeonHands = dungeon.length;
      try {
        // LAST statement: the violation poisons the transaction.
        await tx.execute(sql`
          INSERT INTO lfg_intents (user_id, game_id, status, expires_at)
          VALUES (${userId}, ${gameId}, 'active', now() + interval '7 days')`);
      } catch (err) {
        outcome.duplicateError = pgMessage(err);
      }
      tx.rollback();
    });
  } catch (err) {
    if (!(err instanceof TransactionRollbackError)) throw err;
  }
  return outcome;
}

describe('migration 0320 on old-shape LFG data (ROK-2352 AC2)', () => {
  let outcome: Outcome;

  beforeAll(async () => {
    outcome = await migrateOldShape();
  });

  it("puts every old row — hands, board post, invites — in the '' group", () => {
    expect(outcome.keys).toEqual(['', '', '', '', '', '']);
  });

  it("accepts a dungeon:36 hand next to the user's live '' hand", () => {
    expect(outcome.dungeonHands).toBe(1);
  });

  it("still blocks a second live '' hand for the same user and game", () => {
    expect(outcome.duplicateError).toContain(
      'uq_lfg_intents_user_game_group_active',
    );
  });
});
