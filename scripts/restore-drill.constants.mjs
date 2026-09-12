/**
 * restore-drill.constants.mjs — tunables + mirrored constants for ROK-1160.
 *
 * The three "mirrored" lists below are duplicated from TypeScript sources that
 * a plain .mjs script cannot import. Each names its source of truth; if you
 * change one there, change it here (A2/A5 exist precisely to fail loudly when
 * they drift).
 */

/** Database name inside the throwaway drill container. */
export const DRILL_DB_NAME = 'raid_ledger';

/**
 * D2: must match prod's Postgres major (Dockerfile.allinone) AND carry
 * pgvector — three tables use `vector` columns and a stock image cannot
 * restore them. Same image `validate-migrations.sh:start_postgres` uses.
 */
export const DRILL_IMAGE = 'pgvector/pgvector:pg16';

/** D3: a dump older than this is a finding, not a reason to skip the drill. */
export const MAX_DUMP_AGE_HOURS = 48;

/** A1 floor: a healthy archive's TOC lists far more `TABLE DATA` entries. */
export const MIN_TOC_TABLE_ENTRIES = 20;

/**
 * D5 allowlist. Deliberately EMPTY: T-I7 measured `pg_restore --clean
 * --if-exists` against a fresh database and observed no `pg_restore: error:`
 * lines at all. Only add an entry backed by a recorded measurement — the whole
 * point of the classifier is that it does NOT inherit `isRestoreFatal`'s
 * "errors ignored on restore" tolerance (backup.helpers.ts:145).
 */
export const BENIGN_RESTORE_ERRORS = [];

/** A3. `event_signups` has no `created_at` — schema/event-signups.ts:111. */
export const CORE_COUNT_TABLES = [
  { table: 'users', ts: 'created_at' },
  { table: 'events', ts: 'created_at' },
  { table: 'event_signups', ts: 'signed_up_at' },
  { table: 'games', ts: 'created_at' },
];

/** A2 — mirrors `api/scripts/run-migrations-with-sentry.ts:43-49`. */
export const CRITICAL_TABLES = [
  'community_lineups',
  'community_lineup_matches',
  'community_lineup_match_members',
  'events',
  'users',
];

/** A2 — mirrors `api/scripts/run-migrations-with-sentry.ts:60-63` (ROK-1419). */
export const CRITICAL_INDEXES = [
  'channel_bindings_nonseries_game_unique',
  'channel_bindings_nonseries_nullgame_unique',
];

/** A5 — mirrors `api/src/backup/backup.service.ts:36-41` (ROK-1279). */
export const SANITIZED_EXCLUDED_TABLES = [
  'app_settings',
  'local_credentials',
  'sessions',
  'consumed_intent_tokens',
];

/** D8 layer 2: Sentry cron monitor slug for the missed-run alert. */
export const SENTRY_MONITOR_SLUG = 'backup-restore-drill';
