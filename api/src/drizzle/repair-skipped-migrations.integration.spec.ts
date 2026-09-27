/**
 * ROK-1693: migration 0193 re-applies 0176 (lfg_invites) and 0174
 * (lfg_intents urgency / ttl_minutes) idempotently, repairing databases where
 * Drizzle's migrator skipped them because they merged with an older `when`.
 *
 * The harness DB already ran every migration, so it is the "up to date" case.
 * The "skipped" cases drop the objects first. Every case runs inside a
 * transaction that is rolled back — Postgres DDL is transactional, so the
 * dropped table never leaks to other specs. Statements are split on drizzle's
 * statement-breakpoint marker and executed the way the migrator runs them.
 */
import { readFileSync } from 'fs';
import path from 'path';
import { sql, TransactionRollbackError, type SQL } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';

const REPAIR_SQL_PATH = path.join(
  __dirname,
  'migrations/0193_repair_skipped_0176_0174.sql',
);

type Tx = Parameters<Parameters<TestApp['db']['transaction']>[0]>[0];

interface CatalogState {
  lfgInvites: string | null;
  columns: string[];
  constraints: string[];
  indexes: string[];
  channelPrefsDefault: string | null;
}

let testApp: TestApp;

beforeAll(async () => {
  testApp = await getTestApp();
});

async function applyRepair(tx: Tx): Promise<void> {
  const statements = readFileSync(REPAIR_SQL_PATH, 'utf8')
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter(Boolean);
  for (const statement of statements) await tx.execute(sql.raw(statement));
}

async function list(tx: Tx, query: SQL): Promise<string[]> {
  const rows = (await tx.execute(query)) as unknown as Array<{
    v: string | null;
  }>;
  return rows.map((r) => r.v ?? '');
}

async function readCatalog(tx: Tx): Promise<CatalogState> {
  const [reg] = await list(
    tx,
    sql`SELECT to_regclass('public.lfg_invites')::text AS v`,
  );
  const [prefs] = await list(
    tx,
    sql`
    SELECT column_default AS v FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'user_notification_preferences'
      AND column_name = 'channel_prefs'`,
  );
  const columns = await list(
    tx,
    sql`
    SELECT table_name || '.' || column_name || ' ' || data_type || ' null=' || is_nullable
      || ' default=' || coalesce(column_default, '-') AS v
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name IN ('lfg_invites', 'lfg_intents')
    ORDER BY 1`,
  );
  const constraints = await list(
    tx,
    sql`
    SELECT conrelid::regclass::text || '.' || conname || ': ' || pg_get_constraintdef(oid) AS v
    FROM pg_constraint
    WHERE conrelid IN (SELECT oid FROM pg_class WHERE relnamespace = 'public'::regnamespace
      AND relname IN ('lfg_invites', 'lfg_intents'))
    ORDER BY 1`,
  );
  const indexes = await list(
    tx,
    sql`
    SELECT indexname || ': ' || indexdef AS v FROM pg_indexes
    WHERE schemaname = 'public' AND tablename IN ('lfg_invites', 'lfg_intents')
    ORDER BY 1`,
  );
  return {
    lfgInvites: reg || null,
    columns,
    constraints,
    indexes,
    channelPrefsDefault: prefs || null,
  };
}

/** Runs fn in a transaction, then rolls it back and returns fn's result. */
async function inRolledBackTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  let result: { value: T } | null = null;
  try {
    await testApp.db.transaction(async (tx) => {
      result = { value: await fn(tx) };
      tx.rollback();
    });
  } catch (err) {
    if (!(err instanceof TransactionRollbackError)) throw err;
  }
  if (!result) throw new Error('transaction body did not complete');
  return (result as { value: T }).value;
}

describe('ROK-1693 migration 0193 — repair skipped 0176 / 0174', () => {
  it('re-creates lfg_invites with its FKs, indexes and the channel_prefs default on a DB that skipped 0176', async () => {
    const { before, skipped, after } = await inRolledBackTx(async (tx) => {
      const before = await readCatalog(tx);
      await tx.execute(sql`DROP TABLE "lfg_invites"`);
      await tx.execute(
        sql`ALTER TABLE "user_notification_preferences" ALTER COLUMN "channel_prefs" SET DEFAULT '{}'::jsonb`,
      );
      const skipped = await readCatalog(tx);
      await applyRepair(tx);
      return { before, skipped, after: await readCatalog(tx) };
    });
    expect(skipped.lfgInvites).toBeNull();
    expect(before.lfgInvites).toBe('lfg_invites');
    expect(before.constraints).toEqual(
      expect.arrayContaining([
        'lfg_invites.lfg_invites_game_id_games_id_fk: FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE',
      ]),
    );
    expect(
      before.indexes.filter((i) => i.startsWith('idx_lfg_invites_')),
    ).toHaveLength(3);
    expect(after).toEqual(before);
  });

  it('restores lfg_intents.urgency / ttl_minutes and their CURRENT checks on a DB that skipped 0174', async () => {
    const { before, skipped, after } = await inRolledBackTx(async (tx) => {
      const before = await readCatalog(tx);
      await tx.execute(
        sql`ALTER TABLE "lfg_intents" DROP COLUMN "urgency", DROP COLUMN "ttl_minutes"`,
      );
      const skipped = await readCatalog(tx);
      await applyRepair(tx);
      return { before, skipped, after: await readCatalog(tx) };
    });
    expect(
      skipped.columns.some((c) => c.startsWith('lfg_intents.urgency ')),
    ).toBe(false);
    expect(
      after.constraints.find((c) => c.includes('lfg_intents_urgency_check')),
    ).toContain("'tonight'");
    expect(after).toEqual(before);
  });

  it('is a no-op on an up-to-date DB, and again on a second run', async () => {
    const { before, once, twice } = await inRolledBackTx(async (tx) => {
      const before = await readCatalog(tx);
      await applyRepair(tx);
      const once = await readCatalog(tx);
      await applyRepair(tx);
      return { before, once, twice: await readCatalog(tx) };
    });
    expect(once).toEqual(before);
    expect(twice).toEqual(before);
  });
});
