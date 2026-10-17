#!/usr/bin/env node
/**
 * ROK-1693 — migration merge-order guard.
 *
 * Drizzle's migrator runs a journal entry only when its `when` is GREATER than
 * the newest `created_at` already applied. A branch that generated a migration
 * before another branch's migration landed on main carries an OLDER stamp, so
 * once it merges, every database that already ran main's newer entry silently
 * SKIPS it. That is how 0176_lfg_invites never reached prod: it merged after
 * 0177 and sat mid-journal with an older `when`, so the per-entry order check
 * in fix-migration-order.sh (which only compares neighbours) could not see it.
 *
 * The invariant checked here: every journal entry that is NOT on the base
 * (the merge base with origin/main, or --base <ref>) must be stamped after the
 * base's newest entry AND sit after every base entry in the journal.
 *
 * Usage:
 *   node scripts/check-migration-merge-order.mjs [--base <ref>] [--fix]
 *     --base <ref>  base to compare against (default: merge-base HEAD origin/main)
 *     --fix         re-stamp stale entries at the journal tail, in place
 * Exit: 0 ok · 1 violation (or unfixable under --fix) · 3 base unresolvable.
 * Exit 2 is deliberately unused: validate-ci.sh's run_step reads 2 as SKIPPED.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const JOURNAL_REL = 'api/src/drizzle/migrations/meta/_journal.json';
/** Same bump fix-migration-order.sh applies to an out-of-order entry. */
export const BUMP_MS = 100000;
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Journal entries that would be skipped (or are misplaced) relative to base.
 * `fixable` is true when the entry sits after every base entry, so re-stamping
 * alone is enough; a mid-journal entry needs renumbering (its snapshot's
 * prevId chain points at the wrong parent) and cannot be fixed by a script.
 */
export function findMergeOrderViolations(baseEntries, headEntries) {
  if (baseEntries.length === 0) return [];
  const baseTags = new Set(baseEntries.map((e) => e.tag));
  const top = baseEntries.reduce((a, b) => (b.when > a.when ? b : a));
  const lastBasePos = headEntries.reduce(
    (pos, e, i) => (baseTags.has(e.tag) ? i : pos),
    -1,
  );
  return headEntries.flatMap((e, i) => {
    if (baseTags.has(e.tag)) return [];
    const stale = e.when <= top.when;
    const misplaced = i < lastBasePos;
    if (!stale && !misplaced) return [];
    return [
      {
        tag: e.tag,
        when: e.when,
        baseMaxTag: top.tag,
        baseMaxWhen: top.when,
        stale,
        fixable: !misplaced,
      },
    ];
  });
}

/**
 * Re-stamps every new tail entry so it is strictly after the base's newest
 * entry (and after the entry before it). Never touches a base entry — bumping
 * an already-applied entry's `when` makes Drizzle re-run it. Returns the
 * journal unchanged when any violation is unfixable.
 */
export function restampAfterBase(baseEntries, headEntries) {
  const violations = findMergeOrderViolations(baseEntries, headEntries);
  const unfixable = violations.filter((v) => !v.fixable);
  if (unfixable.length > 0 || violations.length === 0) {
    return { entries: headEntries, changed: [], unfixable };
  }
  const baseTags = new Set(baseEntries.map((e) => e.tag));
  let floor = Math.max(...baseEntries.map((e) => e.when));
  const changed = [];
  const entries = headEntries.map((e) => {
    if (baseTags.has(e.tag)) return e;
    if (e.when > floor) {
      floor = e.when;
      return e;
    }
    floor += BUMP_MS;
    changed.push(e.tag);
    return { ...e, when: floor };
  });
  return { entries, changed, unfixable: [] };
}

/** Human-readable failure text; always names the command that fixes it. */
export function formatReport(violations, baseRef) {
  const lines = [`✗ Migration merge-order guard: ${violations.length} problem(s) vs ${baseRef}`];
  for (const v of violations) {
    lines.push(
      v.stale
        ? `  ${v.tag}: when ${v.when} <= ${v.baseMaxTag} (${v.baseMaxWhen}) on the base — ` +
            `Drizzle SKIPS it on every DB that already ran ${v.baseMaxTag}.`
        : `  ${v.tag}: sits before a base entry in the journal.`,
    );
  }
  if (violations.every((v) => v.fixable)) {
    lines.push('  Fix: run ./scripts/fix-migration-order.sh (re-stamps new entries after the base).');
    return lines.join('\n');
  }
  lines.push(
    '  Fix: re-stamping cannot repair a mid-journal entry (its snapshot prevId points at the',
    '  wrong parent). Renumber it: move its .sql aside, delete its journal entry + snapshot,',
    '  re-run `npm run db:generate -w api` (add `-- --custom --name <name>` for hand-written',
    '  SQL) on top of the base, restore the SQL, then run ./scripts/fix-migration-order.sh.',
  );
  return lines.join('\n');
}

function git(args) {
  return execFileSync('git', args, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function parseArgs(argv) {
  const opts = { base: null, fix: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--fix') opts.fix = true;
    else if (argv[i] === '--base') opts.base = argv[++i];
    else throw new Error(`unknown argument: ${argv[i]}`);
  }
  if (opts.base === undefined) throw new Error('--base needs a git ref');
  return opts;
}

/** Base journal entries, or [] when the base predates the journal. */
function readBaseEntries(ref) {
  let raw;
  try {
    raw = git(['show', `${ref}:${JOURNAL_REL}`]);
  } catch {
    return [];
  }
  return JSON.parse(raw).entries;
}

function resolveBase(explicit) {
  if (explicit) return git(['rev-parse', '--verify', `${explicit}^{commit}`]);
  return git(['merge-base', 'HEAD', 'origin/main']);
}

function writeJournal(journalPath, journal, entries) {
  writeFileSync(journalPath, JSON.stringify({ ...journal, entries }, null, 2) + '\n');
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  let base;
  try {
    base = resolveBase(opts.base);
  } catch (err) {
    console.error(`⚠ merge-order guard: cannot resolve base (${opts.base ?? 'merge-base HEAD origin/main'}): ${err.message.split('\n')[0]}`);
    return 3;
  }
  const journalPath = path.join(REPO_ROOT, JOURNAL_REL);
  const journal = JSON.parse(readFileSync(journalPath, 'utf8'));
  const baseEntries = readBaseEntries(base);
  const violations = findMergeOrderViolations(baseEntries, journal.entries);
  const label = `${opts.base ?? 'merge-base with origin/main'} (${base.slice(0, 9)})`;
  if (violations.length === 0) {
    console.log(`✓ Migration merge-order guard: new entries post-date ${label}`);
    return 0;
  }
  if (!opts.fix) {
    console.error(formatReport(violations, label));
    return 1;
  }
  const { entries, changed, unfixable } = restampAfterBase(baseEntries, journal.entries);
  if (unfixable.length > 0) {
    console.error(formatReport(violations, label));
    return 1;
  }
  writeJournal(journalPath, journal, entries);
  console.log(`✓ Re-stamped ${changed.join(', ')} after ${label} — commit the journal`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exit(main());
  } catch (err) {
    console.error(`✗ merge-order guard: ${err.message}`);
    process.exit(3);
  }
}
