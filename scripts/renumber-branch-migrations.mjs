#!/usr/bin/env node
/**
 * Renumber this branch's NEW Drizzle migrations so they sit after the base's
 * (origin/main's) newest one. Run it through renumber-branch-migrations.sh,
 * which refuses a dirty tree and fetches the base first.
 *
 * "New" = a journal entry whose tag is not in the base journal. For each, in
 * journal order, starting at base max idx + 1:
 *   - NNNN_name.sql is renamed (bytes untouched — SQL bodies are never edited);
 *   - the journal entry gets the new idx/tag, and a `when` strictly after the
 *     base's newest (and the previous entry), so Drizzle never skips it;
 *   - its meta/NNNN_snapshot.json (if the branch wrote one) is renamed and its
 *     prevId repointed: the first at the base's last snapshot id, each next at
 *     the branch snapshot before it. Only the "prevId" line changes.
 * The journal becomes base entries (verbatim) + the renumbered ones, and any
 * base migration file missing from the tree is written from the base, so a
 * later `git merge origin/main` merges the migrations folder cleanly.
 * Idempotent: a branch already numbered after the base is left untouched.
 *
 * The .sh pins --base to a commit SHA; the "Next" text tells you to merge THAT
 * SHA, never a moving origin/main (merging a newer main and keeping ours would
 * drop its newer journal entries).
 *
 * Usage: node scripts/renumber-branch-migrations.mjs --root <repo> [--base <ref>] [--label <name>]
 * Exit: 0 ok · 1 refused/failed · 3 bad args or base unreadable.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUMP_MS } from './check-migration-merge-order.mjs';
import { JOURNAL_REL, MIGRATIONS_REL } from './check-migration-index-collision.mjs';

const META_REL = `${MIGRATIONS_REL}/meta`;
const SNAPSHOT_RE = /^(\d{4})_snapshot\.json$/;
const PREVID_RE = /"prevId": "[^"]*"/;
const pad = (n) => String(n).padStart(4, '0');

function gitIn(root) {
  return (...args) =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 28 });
}

/** Base journal, the base's migration blobs by path, and its last snapshot id. */
function readBase(git, ref) {
  const journal = JSON.parse(git('show', `${ref}:${JOURNAL_REL}`));
  const blobs = new Map();
  for (const line of git('ls-tree', '-r', ref, '--', MIGRATIONS_REL).split('\n')) {
    const m = line.match(/^\d+ blob ([0-9a-f]+)\t(.+)$/);
    if (m) blobs.set(m[2], m[1]);
  }
  const snaps = [...blobs.keys()]
    .map((p) => path.basename(p).match(SNAPSHOT_RE))
    .filter(Boolean)
    .sort((a, b) => Number(a[1]) - Number(b[1]));
  const last = snaps.at(-1);
  const lastSnapshotId = last ? JSON.parse(git('show', `${ref}:${META_REL}/${last[0]}`)).id : null;
  return { entries: journal.entries, blobs, lastSnapshotId };
}

/** A tree snapshot is the branch's when the base has no file there, or a different one. */
function isBranchSnapshot(git, root, base, rel) {
  if (!existsSync(path.join(root, rel))) return false;
  const baseBlob = base.blobs.get(rel);
  return baseBlob === undefined || git('hash-object', rel).trim() !== baseBlob;
}

/** Journal entries + file moves that place `fresh` (branch-only entries) after the base. */
export function planRenumber(baseEntries, fresh) {
  let idx = Math.max(-1, ...baseEntries.map((e) => e.idx)) + 1;
  let floor = Math.max(0, ...baseEntries.map((e) => e.when));
  return fresh.map((e) => {
    const tag = `${pad(idx)}${e.tag.slice(4)}`;
    const when = e.when > floor ? e.when : floor + BUMP_MS;
    floor = when;
    const moved = { from: e.tag, to: tag, oldPrefix: e.tag.slice(0, 4), newPrefix: pad(idx) };
    const out = { entry: { ...e, idx, tag, when }, moved };
    idx += 1;
    return out;
  });
}

/** Branch snapshots in plan order, each with its target path and rewritten body. */
function planSnapshots(git, root, base, plan) {
  let prevId = base.lastSnapshotId;
  const out = [];
  for (const { moved } of plan) {
    const from = `${META_REL}/${moved.oldPrefix}_snapshot.json`;
    if (!isBranchSnapshot(git, root, base, from)) continue;
    const body = readFileSync(path.join(root, from), 'utf8');
    if (!PREVID_RE.test(body)) throw new Error(`${from}: no "prevId" line to repoint`);
    const next = prevId === null ? body : body.replace(PREVID_RE, `"prevId": "${prevId}"`);
    out.push({ from, to: `${META_REL}/${moved.newPrefix}_snapshot.json`, body: next, changed: next !== body });
    prevId = JSON.parse(body).id;
  }
  return out;
}

function sqlMoves(plan) {
  return plan
    .filter(({ moved }) => moved.from !== moved.to)
    .map(({ moved }) => ({ from: `${MIGRATIONS_REL}/${moved.from}.sql`, to: `${MIGRATIONS_REL}/${moved.to}.sql` }));
}

/** Writes the plan. Reads are all done by the caller, so a move never clobbers a source. */
function apply(root, ref, base, { journalText, sql, snaps }) {
  const abs = (rel) => path.join(root, rel);
  for (const m of sql) {
    if (!existsSync(abs(m.from))) throw new Error(`${m.from}: journal entry has no .sql file`);
    if (existsSync(abs(m.to))) throw new Error(`${m.to}: already exists — refusing to overwrite`);
  }
  for (const s of snaps) if (s.from !== s.to) unlinkSync(abs(s.from));
  for (const m of sql) renameSync(abs(m.from), abs(m.to));
  for (const s of snaps) if (s.from !== s.to || s.changed) writeFileSync(abs(s.to), s.body);
  for (const rel of missingBaseFiles(root, base)) {
    writeFileSync(abs(rel), execFileSync('git', ['show', `${ref}:${rel}`], { cwd: root, maxBuffer: 1 << 28 }));
  }
  writeFileSync(abs(JOURNAL_REL), journalText);
}

function missingBaseFiles(root, base) {
  return [...base.blobs.keys()].filter((rel) => rel !== JOURNAL_REL && !existsSync(path.join(root, rel)));
}

function report(plan, snaps, ref, label) {
  for (const { moved } of plan) {
    if (moved.from !== moved.to) console.log(`  ${moved.from} → ${moved.to}`);
  }
  for (const s of snaps) if (s.from !== s.to) console.log(`  ${s.from.split('/').pop()} → ${s.to.split('/').pop()} (prevId repointed)`);
  const named = label && label !== ref ? `${label} @ ${ref}` : ref;
  console.log(`✓ Renumbered ${plan.length} branch migration(s) after ${named}. SQL bodies untouched.`);
  console.log(`  Next: commit, then \`git merge ${ref}\` — this exact commit, not a re-fetched main.`);
  console.log('  _journal.json will conflict (both sides appended) — keep ours, it already holds');
  console.log(`  that commit's entries: git checkout --ours ${JOURNAL_REL} && git add it.`);
  console.log(`  After the merge commit: ./scripts/renumber-branch-migrations.sh --no-fetch --base ${ref}`);
  console.log('  must print "nothing to renumber". Then re-run ./scripts/validate-migrations.sh');
  console.log('  (a renumbered migration now runs AFTER main\'s new ones — if its SQL depends on, or');
  console.log('  its snapshot predates, schema main changed, the drift check / real-Postgres run shows it).');
}

export function renumber(root, ref, label = ref) {
  const git = gitIn(root);
  const base = readBase(git, ref);
  const journal = JSON.parse(readFileSync(path.join(root, JOURNAL_REL), 'utf8'));
  const baseTags = new Set(base.entries.map((e) => e.tag));
  const fresh = journal.entries.filter((e) => !baseTags.has(e.tag));
  if (fresh.length === 0) {
    console.log(`✓ nothing to renumber: no branch-only migrations vs ${ref}`);
    return 0;
  }
  const plan = planRenumber(base.entries, fresh);
  const snaps = planSnapshots(git, root, base, plan);
  const entries = [...base.entries, ...plan.map((p) => p.entry)];
  const current = readFileSync(path.join(root, JOURNAL_REL), 'utf8');
  // drizzle-kit writes the journal with no trailing newline; keep whatever is there.
  const eol = current.endsWith('\n') ? '\n' : '';
  const journalText = JSON.stringify({ ...journal, entries }, null, 2) + eol;
  const sql = sqlMoves(plan);
  const idle = journalText === current && sql.length === 0 && missingBaseFiles(root, base).length === 0 &&
    snaps.every((s) => s.from === s.to && !s.changed);
  if (idle) {
    console.log(`✓ nothing to renumber: ${fresh.length} branch migration(s) already follow ${ref}`);
    return 0;
  }
  apply(root, ref, base, { journalText, sql, snaps });
  report(plan, snaps, ref, label);
  return 0;
}

function parseArgs(argv) {
  const opts = { root: null, base: 'origin/main', label: null };
  for (let i = 0; i < argv.length; i++) {
    const next = argv[i + 1];
    if (argv[i] === '--root' && next) opts.root = path.resolve(argv[++i]);
    else if (argv[i] === '--base' && next) opts.base = argv[++i];
    else if (argv[i] === '--label' && next) opts.label = argv[++i];
    else throw new Error(`unknown or incomplete argument: ${argv[i]}`);
  }
  if (!opts.root) throw new Error('--root <repo> is required');
  return opts;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`✗ renumber: ${err.message}`);
    process.exit(3);
  }
  try {
    process.exit(renumber(opts.root, opts.base, opts.label ?? opts.base));
  } catch (err) {
    console.error(`✗ renumber: ${err.message.split('\n')[0]}`);
    process.exit(1);
  }
}
