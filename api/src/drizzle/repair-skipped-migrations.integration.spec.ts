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
 *
 * 0193 also back-fills the skipped entries' drizzle.__drizzle_migrations rows,
 * because the migrator never writes one for a skipped entry and the restore
 * drill's journal-hashes-present check fails on every dump without it.
 */
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import path from 'path';
import { sql, TransactionRollbackError, type SQL } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');
const REPAIR_SQL_PATH = path.join(
  MIGRATIONS_DIR,
  '0193_repair_skipped_0176_0174.sql',
);

interface JournalEntry {
  tag: string;
  when: number;
  hash: string;
}

/** Journal entries with drizzle's hash (sha256 of the file), as the migrator and restore drill compute it. */
function readJournal(): JournalEntry[] {
  const journalPath = path.join(MIGRATIONS_DIR, 'meta', '_journal.json');
  const { entries } = JSON.parse(readFileSync(journalPath, 'utf8')) as {
    entries: Array<{ tag: string; when: number }>;
  };
  return entries.map(({ tag, when }) => {
    const text = readFileSync(path.join(MIGRATIONS_DIR, `${tag}.sql`));
    return { tag, when, hash: createHash('sha256').update(text).digest('hex') };
  });
}

const JOURNAL = readJournal();
function journalEntry(tag: string): JournalEntry {
  const found = JOURNAL.find((e) => e.tag === tag);
  if (!found) throw new Error(`journal has no entry ${tag}`);
  return found;
}
const E0176 = journalEntry('0176_lfg_invites');
const E0174 = journalEntry('0174_lfg_intent_urgency');
const NEWEST = JOURNAL.reduce((a, b) => (b.when > a.when ? b : a));

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

/** `<hash> <created_at>` per drizzle.__drizzle_migrations row, optionally for one hash. */
async function journalRows(tx: Tx, hash?: string): Promise<string[]> {
  return list(
    tx,
    hash
      ? sql`SELECT hash || ' ' || created_at::text AS v FROM drizzle.__drizzle_migrations WHERE hash = ${hash} ORDER BY id`
      : sql`SELECT hash || ' ' || created_at::text AS v FROM drizzle.__drizzle_migrations ORDER BY id`,
  );
}

/** The row the migrator and the restore drill treat as the latest applied. */
async function latestHash(tx: Tx): Promise<string | undefined> {
  const [hash] = await list(
    tx,
    sql`SELECT hash AS v FROM drizzle.__drizzle_migrations ORDER BY created_at DESC, id DESC LIMIT 1`,
  );
  return hash;
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
    const { before, once, twice, rows } = await inRolledBackTx(async (tx) => {
      const before = await readCatalog(tx);
      const rowsBefore = await journalRows(tx);
      await applyRepair(tx);
      const once = await readCatalog(tx);
      await applyRepair(tx);
      const twice = await readCatalog(tx);
      const rows = { before: rowsBefore, after: await journalRows(tx) };
      return { before, once, twice, rows };
    });
    expect(once).toEqual(before);
    expect(twice).toEqual(before);
    expect(rows.after).toEqual(rows.before);
  });
});

describe('ROK-1693 migration 0193 — back-fills the skipped __drizzle_migrations rows', () => {
  it('pins the back-filled rows to the sha256 and journal `when` of 0176 and 0174', () => {
    const repairSql = readFileSync(REPAIR_SQL_PATH, 'utf8');
    const inserted = [
      ...repairSql.matchAll(/VALUES \('([0-9a-f]{64})', (\d+)\)/g),
    ].map((m) => `${m[1]} ${m[2]}`);
    const guarded = [
      ...repairSql.matchAll(/WHERE hash = '([0-9a-f]{64})'/g),
    ].map((m) => m[1]);
    expect(inserted).toEqual([
      `${E0176.hash} ${E0176.when}`,
      `${E0174.hash} ${E0174.when}`,
    ]);
    expect(guarded).toEqual([E0176.hash, E0174.hash]);
  });

  it('back-fills the skipped hash rows exactly once, so every journal hash is present and 0193 stays latest', async () => {
    const result = await inRolledBackTx(async (tx) => {
      await tx.execute(sql`DROP TABLE "lfg_invites"`);
      await tx.execute(
        sql`DELETE FROM drizzle.__drizzle_migrations WHERE hash IN (${E0176.hash}, ${E0174.hash})`,
      );
      const skipped = await journalRows(tx, E0176.hash);
      await applyRepair(tx);
      await applyRepair(tx);
      return {
        skipped,
        r0176: await journalRows(tx, E0176.hash),
        r0174: await journalRows(tx, E0174.hash),
        all: await journalRows(tx),
        latest: await latestHash(tx),
      };
    });
    expect(result.skipped).toEqual([]);
    expect(result.r0176).toEqual([`${E0176.hash} 1788754699835`]);
    expect(result.r0174).toEqual([`${E0174.hash} 1788655926072`]);
    const restored = new Set(result.all.map((r) => r.split(' ')[0]));
    const missing = JOURNAL.filter((e) => !restored.has(e.hash));
    expect(missing.map((e) => e.tag)).toEqual([]);
    expect(result.latest).toBe(NEWEST.hash);
  });

  it('applies cleanly when the drizzle schema is absent (the validate-migrations.sh psql path)', async () => {
    const { error, before, after } = await inRolledBackTx(async (tx) => {
      const before = await readCatalog(tx);
      await tx.execute(sql`DROP TABLE "lfg_invites"`);
      await tx.execute(
        sql`ALTER SCHEMA drizzle RENAME TO drizzle_rok1693_hidden`,
      );
      const error = await applyRepair(tx).then(
        () => null,
        (err: Error) => err.message,
      );
      return { error, before, after: error ? null : await readCatalog(tx) };
    });
    expect(error).toBeNull();
    expect(after).toEqual(before);
  });
});
