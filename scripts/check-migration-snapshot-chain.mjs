#!/usr/bin/env node
/**
 * TDB:1150 — migration snapshot prevId chain guard.
 *
 * Every drizzle-kit snapshot (meta/NNNN_snapshot.json) records its own `id`
 * and the `prevId` of the snapshot it was generated on top of. The chain had
 * silently rotted: 0102's prevId was the TAG string "0101_regular_adam_destine"
 * instead of 0101's id, and 0112's prevId matched no snapshot at all. drizzle-kit
 * never notices — it only aborts when two snapshots share one prevId — so a
 * broken link survives until someone reasons from the chain and is misled.
 *
 * The invariant checked here, walking snapshots in NUMERIC order:
 *   - the first snapshot's prevId is drizzle's root id (all zeroes);
 *   - every other snapshot's prevId equals the id of the previous EXISTING
 *     snapshot (gaps are normal — a --custom migration writes no snapshot —
 *     so the chain follows snapshot files, not journal indexes);
 *   - every id is a non-empty string and unique.
 *
 * Usage:
 *   node scripts/check-migration-snapshot-chain.mjs [--dir <meta dir>]
 *     --dir <path>  snapshot directory (default: api/src/drizzle/migrations/meta)
 * Exit: 0 ok · 1 chain violation · 3 unreadable/malformed snapshot or bad args.
 * Exit 2 is deliberately unused: validate-ci.sh's run_step reads 2 as SKIPPED.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const META_REL = 'api/src/drizzle/migrations/meta';
/** drizzle-kit's prevId for the very first snapshot of a migrations folder. */
export const ROOT_PREV_ID = '00000000-0000-0000-0000-000000000000';
const SNAPSHOT_RE = /^(\d+)_snapshot\.json$/;
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Snapshot file names only, in numeric order of their NNNN prefix. */
export function orderSnapshotFiles(fileNames) {
  return fileNames
    .filter((f) => SNAPSHOT_RE.test(f))
    .sort((a, b) => Number(a.match(SNAPSHOT_RE)[1]) - Number(b.match(SNAPSHOT_RE)[1]));
}

const isId = (v) => typeof v === 'string' && v.length > 0;

function linkViolation(snap, prev, idToFile) {
  const expected = prev ? prev.id : ROOT_PREV_ID;
  if (snap.prevId === expected) return null;
  return {
    kind: 'broken-link',
    file: snap.file,
    prevId: snap.prevId,
    expected,
    expectedFile: prev ? prev.file : null,
    pointsAt: idToFile.get(snap.prevId) ?? null,
  };
}

/**
 * Chain violations for snapshots given as [{ file, id, prevId }] in numeric
 * order (see orderSnapshotFiles). Empty array means the chain is intact.
 */
export function findChainViolations(snapshots) {
  const idToFile = new Map();
  for (const s of snapshots) {
    if (isId(s.id) && !idToFile.has(s.id)) idToFile.set(s.id, s.file);
  }
  const violations = [];
  let prev = null;
  for (const snap of snapshots) {
    if (!isId(snap.id) || !isId(snap.prevId)) {
      violations.push({ kind: 'malformed', file: snap.file });
    } else if (idToFile.get(snap.id) !== snap.file) {
      violations.push({ kind: 'duplicate-id', file: snap.file, id: snap.id, firstFile: idToFile.get(snap.id) });
    }
    const link = isId(snap.prevId) ? linkViolation(snap, prev, idToFile) : null;
    if (link) violations.push(link);
    prev = snap;
  }
  return violations;
}

function describe(v) {
  if (v.kind === 'malformed') return `  ${v.file}: id/prevId missing or not a non-empty string.`;
  if (v.kind === 'duplicate-id') {
    return `  ${v.file}: id ${v.id} is already used by ${v.firstFile} — give ${v.file} a fresh ` +
      `UUID (crypto.randomUUID()) and repoint the snapshot after it.`;
  }
  const target = v.pointsAt ? `${v.pointsAt}'s id` : 'no snapshot';
  const want = v.expectedFile ? `${v.expectedFile}'s id` : "drizzle's root id";
  return `  ${v.file}: prevId ${v.prevId} (${target}) should be ${v.expected} (${want}).`;
}

/** Human-readable failure text; always says how to repair each problem. */
export function formatReport(violations) {
  return [
    `✗ Migration snapshot chain: ${violations.length} problem(s)`,
    ...violations.map(describe),
    '  Fix: point each broken prevId at the id of the snapshot immediately before it in',
    '  numeric order (snapshot gaps are normal). Never change an id another snapshot',
    '  already points at — repoint the prevId instead.',
  ].join('\n');
}

/** Reads every snapshot in `dir` as [{ file, id, prevId }], numeric order. */
export function readSnapshots(dir) {
  return orderSnapshotFiles(readdirSync(dir)).map((file) => {
    let raw;
    try {
      raw = JSON.parse(readFileSync(path.join(dir, file), 'utf8'));
    } catch (err) {
      throw new Error(`${file}: not valid JSON (${err.message.split('\n')[0]})`);
    }
    return { file, id: raw.id, prevId: raw.prevId };
  });
}

function parseArgs(argv) {
  const opts = { dir: path.join(REPO_ROOT, META_REL) };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--dir' && argv[i + 1]) opts.dir = path.resolve(argv[++i]);
    else throw new Error(`unknown or incomplete argument: ${argv[i]}`);
  }
  return opts;
}

function main() {
  const { dir } = parseArgs(process.argv.slice(2));
  const snapshots = readSnapshots(dir);
  if (snapshots.length === 0) throw new Error(`no NNNN_snapshot.json files in ${dir}`);
  const violations = findChainViolations(snapshots);
  if (violations.length > 0) {
    console.error(formatReport(violations));
    return 1;
  }
  const first = snapshots[0].file;
  const last = snapshots[snapshots.length - 1].file;
  console.log(`✓ Migration snapshot chain: ${snapshots.length} snapshots linked ${first} → ${last}`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exit(main());
  } catch (err) {
    console.error(`✗ snapshot chain guard: ${err.message}`);
    process.exit(3);
  }
}
