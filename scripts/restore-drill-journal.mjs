#!/usr/bin/env node
/**
 * restore-drill-journal.mjs — ROK-1160 D4 journal verification.
 *
 * Operator ruling 2026-09-22 (option b): PROD dumps keep the `drizzle` schema
 * (`backup.helpers.ts::pgDumpArgs`, `keepJournal`), so a restore carries the
 * migration journal. This check runs AFTER pg_restore and BEFORE
 * `reconcile-migrations.mjs` (reconcile inserts missing hashes, so checking
 * afterwards would hide exactly the defect this exists to catch) and asserts:
 *   - `journal-hashes-present`: every entry of the image's
 *     `meta/_journal.json` has its hash in `drizzle.__drizzle_migrations`.
 *     EXTRA restored rows are reported but do not fail: prod legitimately
 *     carries historical rows no journal lists (e.g. the orphaned draft hash
 *     left by testing a pre-merge branch against prod), so an exact row count
 *     would fail every week;
 *   - `journal-latest-hash`: the newest restored row's hash equals the hash of
 *     the journal entry with the greatest `when` — drizzle stores `when` as
 *     `created_at`, and `when` is not guaranteed monotonic in array order.
 * Both are tier `reconcile` (the contract's tier enum has no journal tier).
 *
 * I/O is injected (`sql(text) => Promise<rows[]>`) so the unit spec needs no
 * database. CLI: `--database-url <url> --migrations-dir <dir>` prints the
 * findings as a JSON array on stdout; exit 2 = harness error.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TIER = 'reconcile';
const finding = (id, status, detail) => ({ id, tier: TIER, status, detail });

/** Journal entries of a drizzle-kit migrations folder, with drizzle's hash. */
export function readJournal(migrationsDir) {
  const journalPath = path.join(migrationsDir, 'meta', '_journal.json');
  const { entries } = JSON.parse(fs.readFileSync(journalPath, 'utf8'));
  return entries.map(({ tag, when }) => {
    const sqlText = fs.readFileSync(path.join(migrationsDir, `${tag}.sql`));
    const hash = crypto.createHash('sha256').update(sqlText).digest('hex');
    return { tag, when, hash };
  });
}

const missingTable = () => [
  finding(
    'journal-hashes-present',
    'failed',
    'restored DB has no drizzle.__drizzle_migrations — the dump was taken ' +
      'without the journal (pre-D4 or the dev dump path)',
  ),
];

async function latestHashFinding(sql, journal) {
  const [row] = await sql(
    'SELECT hash FROM drizzle.__drizzle_migrations ' +
      'ORDER BY created_at DESC, id DESC LIMIT 1',
  );
  const expected = journal.reduce(
    (max, e) => (max === undefined || e.when > max.when ? e : max),
    undefined,
  );
  if (row && expected && row.hash === expected.hash) {
    return finding('journal-latest-hash', 'passed', `matches ${expected.tag}`);
  }
  return finding(
    'journal-latest-hash',
    'failed',
    `latest restored hash ${row?.hash ?? '(none)'} != ` +
      `${expected?.tag ?? '(empty journal)'} ${expected?.hash ?? ''}`.trim(),
  );
}

function hashesPresentFinding(rows, journal) {
  const restored = new Set(rows.map((r) => r.hash));
  const known = new Set(journal.map((e) => e.hash));
  const missing = journal.filter((e) => !restored.has(e.hash));
  const extra = [...restored].filter((h) => !known.has(h)).length;
  const note = extra
    ? `; ${extra} extra restored row(s) not in the image journal (informational)`
    : '';
  if (missing.length) {
    const tags = missing.slice(0, 5).map((e) => e.tag).join(', ');
    const more = missing.length > 5 ? ` (+${missing.length - 5} more)` : '';
    return finding(
      'journal-hashes-present',
      'failed',
      `missing ${missing.length} of ${journal.length} image journal hashes: ` +
        `${tags}${more}${note}`,
    );
  }
  return finding(
    'journal-hashes-present',
    'passed',
    `all ${journal.length} image journal hashes present${note}`,
  );
}

/** D4: the restored journal covers the image's migrations. */
export async function runJournalCheck({ sql, journal }) {
  const [{ t }] = await sql(
    "SELECT to_regclass('drizzle.__drizzle_migrations')::text AS t",
  );
  if (!t) return missingTable();
  const rows = await sql('SELECT hash FROM drizzle.__drizzle_migrations');
  return [
    hashesPresentFinding(rows, journal),
    await latestHashFinding(sql, journal),
  ];
}

async function main(argv) {
  const arg = (n) => {
    const i = argv.indexOf(n);
    return i === -1 ? undefined : argv[i + 1];
  };
  const journal = readJournal(arg('--migrations-dir'));
  const { default: postgres } = await import('postgres');
  const client = postgres(arg('--database-url'), { max: 1, onnotice: () => {} });
  try {
    const findings = await runJournalCheck({
      sql: (text) => client.unsafe(text),
      journal,
    });
    process.stdout.write(JSON.stringify(findings));
  } finally {
    await client.end({ timeout: 5 });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(`ERROR: ${err?.message ?? err}`);
    process.exit(2);
  });
}
