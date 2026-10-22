#!/usr/bin/env node
/**
 * Migration index-collision guard.
 *
 * Two open PRs each generate "the next" migration on top of the same main, so
 * both claim 0239 (journal idx, NNNN_name.sql and meta/0239_snapshot.json).
 * Whichever lands second collides. This fails fast, before any DB step, when:
 *   - a journal entry new to this branch (tag not on the base) has an idx at or
 *     below the base's newest idx (it collides with, or sits under, main's);
 *   - two journal entries share an idx, or two tags share an NNNN prefix;
 *   - an entry's tag prefix disagrees with its idx;
 *   - two .sql files in the migrations folder share an NNNN prefix.
 * Every report names the one command that fixes it.
 *
 * Usage:
 *   node scripts/check-migration-index-collision.mjs [--base <ref>] [--root <dir>]
 *     --base <ref>  base to compare against (default: origin/main — the TIP, not
 *                   the merge base: the point is to see what main has taken since)
 *     --root <dir>  repo root (default: this script's repo)
 * Exit: 0 ok · 1 collision · 3 base unresolvable or bad args.
 * Exit 2 is deliberately unused: validate-ci.sh's run_step reads 2 as SKIPPED.
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const MIGRATIONS_REL = 'api/src/drizzle/migrations';
export const JOURNAL_REL = `${MIGRATIONS_REL}/meta/_journal.json`;
export const FIX_COMMAND = './scripts/renumber-branch-migrations.sh';
const PREFIX_RE = /^(\d{4})_/;
const DEFAULT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const prefixOf = (name) => name.match(PREFIX_RE)?.[1] ?? null;

function journalViolations(baseEntries, headEntries) {
  const baseTags = new Set(baseEntries.map((e) => e.tag));
  const baseTop = baseEntries.reduce((a, b) => (b.idx > a.idx ? b : a), { idx: -1, tag: null });
  const byIdx = new Map();
  const byPrefix = new Map();
  const out = [];
  for (const e of headEntries) {
    const prefix = prefixOf(e.tag);
    if (prefix !== null && Number(prefix) !== e.idx) {
      out.push({ kind: 'tag-idx-mismatch', tag: e.tag, idx: e.idx });
    }
    if (byIdx.has(e.idx)) {
      out.push({ kind: 'duplicate-idx', tag: e.tag, idx: e.idx, other: byIdx.get(e.idx) });
    } else if (prefix !== null && byPrefix.has(prefix)) {
      out.push({ kind: 'duplicate-prefix', tag: e.tag, prefix, other: byPrefix.get(prefix) });
    }
    if (!baseTags.has(e.tag) && e.idx <= baseTop.idx) {
      const clash = baseEntries.find((b) => b.idx === e.idx);
      out.push({ kind: 'collides-with-base', tag: e.tag, idx: e.idx, other: clash?.tag ?? null, baseTop: baseTop.tag });
    }
    if (!byIdx.has(e.idx)) byIdx.set(e.idx, e.tag);
    if (prefix !== null && !byPrefix.has(prefix)) byPrefix.set(prefix, e.tag);
  }
  return out;
}

function fileViolations(sqlFiles) {
  const seen = new Map();
  const out = [];
  for (const f of [...sqlFiles].sort()) {
    const prefix = prefixOf(f);
    if (prefix === null) continue;
    if (seen.has(prefix)) out.push({ kind: 'duplicate-file-prefix', tag: f, prefix, other: seen.get(prefix) });
    else seen.set(prefix, f);
  }
  return out;
}

/**
 * Collisions for a branch journal (headEntries) against the base journal, plus
 * the migrations folder's .sql file names. Empty array means no collision.
 */
export function findIndexCollisions(baseEntries, headEntries, sqlFiles) {
  return [...journalViolations(baseEntries, headEntries), ...fileViolations(sqlFiles)];
}

function describe(v, baseRef) {
  switch (v.kind) {
    case 'collides-with-base':
      return v.other
        ? `  ${v.tag}: idx ${v.idx} collides with ${baseRef}'s ${v.other} (main took this number first).`
        : `  ${v.tag}: idx ${v.idx} is not after ${baseRef}'s newest entry ${v.baseTop}.`;
    case 'duplicate-idx':
      return `  ${v.tag}: idx ${v.idx} is already used by ${v.other} in the journal.`;
    case 'duplicate-prefix':
      return `  ${v.tag}: prefix ${v.prefix} is already used by ${v.other} in the journal.`;
    case 'tag-idx-mismatch':
      return `  ${v.tag}: tag prefix does not match its idx ${v.idx}.`;
    default:
      return `  ${v.tag}: shares prefix ${v.prefix} with ${v.other} in ${MIGRATIONS_REL}/.`;
  }
}

/** Human-readable failure text; always names the command that fixes it. */
export function formatCollisionReport(violations, baseRef) {
  return [
    `✗ Migration index collision: ${violations.length} problem(s) vs ${baseRef}`,
    ...violations.map((v) => describe(v, baseRef)),
    `  Fix: git fetch origin && ${FIX_COMMAND}`,
    '  (renumbers this branch\'s new migrations after origin/main: files, journal idx/tag/when,',
    '  snapshot names + prevId chain), then commit, merge origin/main and re-run',
    '  ./scripts/validate-migrations.sh.',
  ].join('\n');
}

function parseArgs(argv) {
  const opts = { base: 'origin/main', root: DEFAULT_ROOT };
  for (let i = 0; i < argv.length; i++) {
    const next = argv[i + 1];
    if (argv[i] === '--base' && next) opts.base = argv[++i];
    else if (argv[i] === '--root' && next) opts.root = path.resolve(argv[++i]);
    else throw new Error(`unknown or incomplete argument: ${argv[i]}`);
  }
  return opts;
}

function readBaseEntries(root, ref) {
  let raw;
  try {
    raw = execFileSync('git', ['show', `${ref}:${JOURNAL_REL}`], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch {
    return null;
  }
  return JSON.parse(raw).entries;
}

function main() {
  const { base, root } = parseArgs(process.argv.slice(2));
  const baseEntries = readBaseEntries(root, base);
  if (baseEntries === null) {
    console.error(`⚠ index-collision guard: cannot read ${JOURNAL_REL} at ${base} (git fetch origin?)`);
    return 3;
  }
  const headEntries = JSON.parse(readFileSync(path.join(root, JOURNAL_REL), 'utf8')).entries;
  const sqlFiles = readdirSync(path.join(root, MIGRATIONS_REL)).filter((f) => f.endsWith('.sql'));
  const violations = findIndexCollisions(baseEntries, headEntries, sqlFiles);
  if (violations.length > 0) {
    console.error(formatCollisionReport(violations, base));
    return 1;
  }
  console.log(`✓ Migration index-collision guard: no new entry collides with ${base}`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exit(main());
  } catch (err) {
    console.error(`✗ index-collision guard: ${err.message}`);
    process.exit(3);
  }
}
