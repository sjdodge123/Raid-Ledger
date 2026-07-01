/**
 * ROK-1281 / ROK-1322: Instrumented migration runner.
 *
 * Two-phase migration:
 *   1. Refresh `games_dedup_audit` via the in-process union-find detection
 *      so any data migration that consumes the audit table sees current
 *      state (independent of cron timing). Prevents the ROK-1278 outage
 *      mode where 0140 failed because prod's audit was stale.
 *   2. Run drizzle migrations, then validate the journal + critical tables.
 *
 * Any unhandled error in either phase is captured by Sentry (with a
 * caller-supplied context tag) and flushed BEFORE the error propagates, so
 * incidents are visible in alerting rather than only on stdout.
 *
 * TWO call sites share this ONE contract (ROK-1322):
 *   - Deploy boot (`docker-entrypoint.sh` → `main()`) — context `boot.migration`.
 *   - Restore / factory-reset (`backup.helpers.ts::runMigrations`) — passes its
 *     already-resolved migrations folder + context `restore-migration` via
 *     `runBootMigrations(url, opts)`, so restore gets the same dedup refresh +
 *     validation + instrumentation as boot without a divergent code path.
 *
 * MUST stay self-contained — no NestJS bootstrap. The migration phase
 * runs before the app DI container exists.
 */
import '../src/sentry/instrument'; // MUST be first — installs Sentry handlers
import * as Sentry from '@sentry/nestjs';

import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import * as fs from 'fs';
import * as path from 'path';

import { groupRowsByConnectedKeys } from '../src/admin/games-dedup-union-find.helpers';
import {
  pickCanonicalId,
  type GameRow,
} from '../src/admin/games-dedup-audit.helpers';

/** Default folder used by the boot path; restore overrides via opts. */
const DEFAULT_MIGRATIONS_FOLDER =
  process.env.MIGRATIONS_FOLDER ?? './drizzle/migrations';
const CRITICAL_TABLES = [
  'community_lineups',
  'community_lineup_matches',
  'community_lineup_match_members',
  'events',
  'users',
];

type SqlClient = ReturnType<typeof postgres>;

interface GamesDbRow {
  id: number;
  name: string;
  slug: string;
  igdb_id: number | null;
  itad_game_id: string | null;
  steam_app_id: number | null;
  cached_at: Date;
}

/**
 * Recompute `games_dedup_audit` from the live `games` table. Safe to call
 * on a fresh DB (skips if tables don't exist yet) and idempotent across
 * container restarts.
 */
export async function refreshDedupAudit(client: SqlClient): Promise<number> {
  const exists = await tableExists(client, 'games_dedup_audit');
  if (!exists) {
    console.log(
      'ℹ️  games_dedup_audit table does not exist yet; skipping audit refresh (fresh DB).',
    );
    return 0;
  }
  const gamesExists = await tableExists(client, 'games');
  if (!gamesExists) {
    console.log('ℹ️  games table does not exist yet; skipping audit refresh.');
    return 0;
  }

  const rows = (await client`
    SELECT id, name, slug, igdb_id, itad_game_id, steam_app_id, cached_at
    FROM games
  `) as unknown as GamesDbRow[];

  const gameRows: GameRow[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    slug: r.slug,
    igdbId: r.igdb_id,
    itadGameId: r.itad_game_id,
    steamAppId: r.steam_app_id,
    cachedAt: r.cached_at,
  }));

  const groups = groupRowsByConnectedKeys(gameRows);
  console.log(
    `📊 dedup detection: ${rows.length} games → ${groups.length} dup groups`,
  );

  await client`TRUNCATE TABLE games_dedup_audit RESTART IDENTITY`;
  if (groups.length === 0) return 0;

  const snapshotAt = new Date();
  let inserted = 0;
  for (const group of groups) {
    const canonicalId = pickCanonicalId(group.rows);
    const dupIds = group.rows
      .map((r) => r.id)
      .filter((id) => id !== canonicalId);
    // downstream_counts / unique_conflicts are NOT NULL on the schema but the
    // boot-time migration only reads canonical_game_id + dup_game_ids. Stub
    // them with empty objects; the nightly cron will recompute real values
    // once the API is healthy. The migration's audit-row consumers (FK
    // repoints, DELETE, TRUNCATE) ignore these jsonb columns entirely.
    await client`
      INSERT INTO games_dedup_audit (
        match_type, match_key, canonical_game_id, dup_game_ids,
        group_size, downstream_counts, unique_conflicts, snapshot_at
      ) VALUES (
        ${group.matchType}, ${group.matchKey}, ${canonicalId}, ${dupIds},
        ${group.rows.length}, ${client.json({})}, ${client.json({})}, ${snapshotAt}
      )
    `;
    inserted += 1;
  }
  console.log(`✅ games_dedup_audit refreshed: ${inserted} group(s) recorded`);
  return inserted;
}

async function tableExists(client: SqlClient, name: string): Promise<boolean> {
  const rows = (await client`
    SELECT EXISTS (
      SELECT FROM pg_tables
      WHERE schemaname = 'public' AND tablename = ${name}
    ) AS exists
  `) as unknown as Array<{ exists: boolean }>;
  return rows[0]?.exists === true;
}

export async function runDrizzleMigrate(
  client: SqlClient,
  migrationsFolder: string = DEFAULT_MIGRATIONS_FOLDER,
): Promise<void> {
  const db = drizzle(client);
  console.log('📦 Running drizzle migrations...');
  await migrate(db, { migrationsFolder });
  console.log('✅ Drizzle migrate complete.');
}

export async function validateMigrationState(
  client: SqlClient,
  migrationsFolder: string = DEFAULT_MIGRATIONS_FOLDER,
): Promise<{ applied: number; expected: number; missing: string[] }> {
  const journalPath = path.join(migrationsFolder, 'meta', '_journal.json');
  const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8')) as {
    entries: unknown[];
  };
  const expected = journal.entries.length;
  const appliedRows = (await client`
    SELECT count(*)::int AS applied FROM drizzle.__drizzle_migrations
  `) as unknown as Array<{ applied: number }>;
  const applied = appliedRows[0]?.applied ?? 0;
  if (applied < expected) {
    console.error(
      `⚠️  MIGRATION MISMATCH: ${applied} applied vs ${expected} in journal.`,
    );
    console.error('   Run: ./scripts/fix-migration-order.sh');
  } else {
    console.log(`✅ Migrations completed (${applied}/${expected} applied).`);
  }

  const missing: string[] = [];
  for (const t of CRITICAL_TABLES) {
    const rows =
      (await client`SELECT to_regclass(${`public.${t}`}) AS oid`) as unknown as Array<{
        oid: string | null;
      }>;
    if (!rows[0]?.oid) missing.push(t);
  }
  if (missing.length > 0) {
    console.warn(
      `⚠️  PHANTOM MIGRATION: tables missing despite ${applied} migrations applied: ${missing.join(', ')}`,
    );
  }
  return { applied, expected, missing };
}

export interface BootMigrationOptions {
  /**
   * Override the migrations folder. The restore path passes its own
   * already-resolved folder so the switch to this runner does NOT silently
   * change which migrations restore applies. Boot omits it and uses
   * `DEFAULT_MIGRATIONS_FOLDER`.
   */
  migrationsFolder?: string;
  /**
   * Sentry failure-tag context. `boot.migration` (default) for deploy boot,
   * `restore-migration` for the backup restore / factory-reset path.
   */
  context?: string;
}

/**
 * Run the refresh → migrate → validate phase against `databaseUrl`, capturing
 * any failure to Sentry (tagged with `opts.context`) and flushing BEFORE the
 * error propagates. The original migration error is always re-thrown, even if
 * the Sentry flush itself fails, so callers keep their propagation semantics.
 */
export async function runBootMigrations(
  databaseUrl: string,
  opts: BootMigrationOptions = {},
): Promise<void> {
  const migrationsFolder = opts.migrationsFolder ?? DEFAULT_MIGRATIONS_FOLDER;
  const context = opts.context ?? 'boot.migration';
  const client = postgres(databaseUrl, { max: 1 });
  try {
    await refreshDedupAudit(client);
    await runDrizzleMigrate(client, migrationsFolder);
    await validateMigrationState(client, migrationsFolder);
    console.log('🚀 Migration phase complete.');
  } catch (err) {
    // Instrument here (not just in main's catch) so the RESTORE call site gets
    // the same capture+flush contract without double-capturing.
    await reportBootFailure(err, context).catch(() => undefined);
    throw err;
  } finally {
    await client.end({ timeout: 5 });
  }
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('❌ DATABASE_URL is required');
    process.exit(1);
  }
  await runBootMigrations(databaseUrl);
}

/**
 * Capture a migration failure to Sentry, wait for the event to flush, then
 * return. Extracted so the Sentry-capture contract is unit-testable without
 * forking a Node process. `context` is the failure tag: `boot.migration` for
 * deploy boot, `restore-migration` for the restore path (ROK-1322).
 */
export async function reportBootFailure(
  err: unknown,
  context: string = 'boot.migration',
): Promise<void> {
  console.error('❌ Migration error:', err);
  Sentry.captureException(err, { tags: { context } });
  await Sentry.flush(2000);
}

// Allow importing the helpers without triggering main() when the runner is
// require()'d by tests OR statically imported by the app (backup.helpers).
// Only run when invoked as a script. runBootMigrations already captured +
// flushed any failure, so the catch here just sets the exit code.
if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}
