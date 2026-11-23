#!/usr/bin/env node
// The `scripts/lane-check.sh` planner (ROK-2310).
//
// A lane runs lane-check.sh before it reports "green". This module decides
// WHAT to run from the branch's changed files (and, for removed user-visible
// strings, the unified diff). It is pure and dependency-free; lane-check.sh
// runs the steps.
//
// Path -> workspace mapping reuses scoped-gate-plan.mjs's targetFor(), so the
// two gates cannot disagree about which surface a path belongs to.
//
// Selection rules:
//   - api/src/**, web/src/** source or spec: the file's WHOLE folder runs
//     (jest / vitest). Folders under an already-selected ancestor collapse into
//     it. A file directly in api/src or web/src runs "related tests only"
//     (jest --findRelatedTests / vitest related) instead of the whole tree.
//   - any api/** or web/** file selects that workspace's spec typecheck
//     (api/tsconfig.json covers src + specs; web/tsconfig.test.json covers
//     src incl. specs and src/test/**) and eslint on its changed lint files.
//   - tools/<x>/** selects that tool's tests, typecheck and (test-bot) eslint.
//   - packages/contract/** selects the contract's own tests plus the contract,
//     api AND web typechecks.
//   - scripts/smoke/**, playwright.config.*, scripts/*.ts: the smoke typecheck.
//   - scripts/*.mjs: `node --test` its .spec.mjs (itself or sibling);
//     scripts/**/*.sh: `bash -n`.
//   - docs, markdown, .claude/**, planning-artifacts/**: nothing.
//
// smokeStrings: string literals (>= 8 chars) on REMOVED lines of non-test
// source files that appear in no literal on any ADDED line. lane-check.sh greps
// scripts/smoke/** and tools/test-bot/src/smoke/** for each — a hit means a
// smoke spec still pins text the diff took away. Import/require lines and
// path-like literals (no whitespace, contains '/' or starts with '.' or '@')
// are skipped to keep false positives few. Test ids are kept on purpose.
//
// CLI: node scripts/lane-check-plan.mjs [--diff <file>] [--lines] < files
//   stdin: changed paths, one per line. Paths that no longer exist on disk are
//   dropped from folder/eslint selection (a deleted file has nothing to run)
//   but still count for workspace typechecks.
//   default output: the plan as JSON. --lines: tab-separated `kind\ttarget`
//   rows for the shell runner (see lane-check.sh).

import { existsSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { targetFor } from './scoped-gate-plan.mjs';

const SOURCE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
const NOTHING = [/^docs\//, /^planning-artifacts\//, /^\.claude\//, /\.md$/];
const TEST_FILE = /(\.(spec|test)\.[cm]?[jt]sx?$)|(^|\/)(__tests__|test|tests|smoke)\//;
const WS_ROOTS = { api: 'api/src', web: 'web/src' };
const ESLINT_WS = { api: 'api', web: 'web', 'tool:test-bot': 'tools/test-bot' };
const MIN_LEN = 8;

/** Workspace of a path: contract | api | web | smoke | scripts | tool:<x> | null. */
export function workspaceOf(path) {
  if (NOTHING.some((re) => re.test(path))) return null;
  if (/^packages\/contract\//.test(path)) return 'contract';
  return targetFor(path);
}

/** Drop every folder that has a selected ancestor. */
export function collapseFolders(folders) {
  const sorted = [...new Set(folders)].sort();
  return sorted.filter((f) => !sorted.some((a) => a !== f && f.startsWith(`${a}/`)));
}

function emptyPlan() {
  return {
    jest: [], vitest: [], jestRelated: [], vitestRelated: [],
    toolTests: [], contractTests: false, nodeTests: [], shellParse: [], typecheck: [], eslint: {},
    smokeStrings: [], skipped: [],
  };
}

/** Folder / related-test selection for an api or web source path. */
function selectTests(plan, ws, path) {
  const root = WS_ROOTS[ws];
  if (!path.startsWith(`${root}/`) || !SOURCE_EXT.test(path)) return;
  const dir = dirname(path);
  const runner = ws === 'api' ? 'jest' : 'vitest';
  if (dir === root) plan[`${runner}Related`].push(path);
  else plan[runner].push(dir);
}

function addLint(plan, ws, path) {
  const base = ESLINT_WS[ws];
  if (!base || !/\.(ts|tsx|js|jsx|mjs)$/.test(path)) return;
  (plan.eslint[ws] ??= []).push(path.slice(base.length + 1));
}

/** scripts/**: node --test its spec (or its sibling spec), bash -n a .sh. */
function addScript(plan, path, exists) {
  if (!exists(path)) return;
  const spec = path.replace(/(\.spec)?\.mjs$/, '.spec.mjs');
  if (path.endsWith('.sh')) plan.shellParse.push(path);
  else if (path.endsWith('.mjs') && exists(spec)) plan.nodeTests.push(spec);
  else plan.skipped.push(`${path}: no spec or parse check`);
}

function addWorkspace(plan, typecheck, ws, path, exists) {
  if (ws === 'contract') {
    plan.contractTests = true;
    ['contract', 'api', 'web'].forEach((t) => typecheck.add(t));
    return;
  }
  if (ws === 'scripts') return void addScript(plan, path, exists);
  typecheck.add(ws);
  if (ws.startsWith('tool:') && !plan.toolTests.includes(ws.slice(5))) plan.toolTests.push(ws.slice(5));
  if (!exists(path)) return;
  if (ws === 'api' || ws === 'web') selectTests(plan, ws, path);
  addLint(plan, ws, path);
}

/**
 * Plan a lane check.
 * @param {string[]} files - repo-relative changed paths.
 * @param {{diff?: string, exists?: (p: string) => boolean}} [opts]
 */
export function planLaneCheck(files, { diff = '', exists = () => true } = {}) {
  const plan = emptyPlan();
  const typecheck = new Set();
  const paths = [...new Set(files.map((f) => f.trim()).filter(Boolean))].sort();
  for (const path of paths) {
    const ws = workspaceOf(path);
    if (ws) addWorkspace(plan, typecheck, ws, path, exists);
    else if (!NOTHING.some((re) => re.test(path))) plan.skipped.push(`${path}: no lane-check surface`);
  }
  plan.jest = collapseFolders(plan.jest);
  plan.vitest = collapseFolders(plan.vitest);
  plan.typecheck = [...typecheck].sort();
  plan.nodeTests = [...new Set(plan.nodeTests)];
  plan.smokeStrings = removedStrings(diff);
  return plan;
}

/** String literals on one line, import/require/path-like ones excluded. */
export function literalsOf(line) {
  if (/^\s*(import\b|export\s.*\bfrom\b)|\brequire\(|\bimport\(/.test(line)) return [];
  const out = [];
  const re = /'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|`((?:[^`\\$]|\\.)*)`/g;
  for (const m of line.matchAll(re)) {
    const s = m[1] ?? m[2] ?? m[3] ?? '';
    if (s.length < MIN_LEN) continue;
    if (!/\s/.test(s) && (/\//.test(s) || /^[.@]/.test(s))) continue;
    out.push(s);
  }
  return out;
}

/** Is a diff path a non-test source file whose removed strings count? */
function countsForSmoke(path) {
  if (!path || !SOURCE_EXT.test(path) || TEST_FILE.test(path)) return false;
  return /^(api|web|packages\/contract)\//.test(path);
}

/** Literals removed by the diff that no added line brings back. */
export function removedStrings(diff) {
  const removed = new Set();
  const added = new Set();
  let file = null;
  for (const line of diff.split('\n')) {
    const header = /^\+\+\+ (?:b\/)?(.*)$/.exec(line);
    if (header) { file = header[1] === '/dev/null' ? null : header[1]; continue; }
    if (line.startsWith('--- ')) { file = /^--- (?:a\/)?(.*)$/.exec(line)?.[1] ?? null; continue; }
    if (line.startsWith('+')) literalsOf(line.slice(1)).forEach((s) => added.add(s));
    else if (line.startsWith('-') && countsForSmoke(file)) literalsOf(line.slice(1)).forEach((s) => removed.add(s));
  }
  return [...removed].filter((s) => !added.has(s)).sort();
}

/** Tab-separated rows for lane-check.sh. */
export function toLines(plan) {
  const rows = [];
  plan.typecheck.forEach((t) => rows.push(['typecheck', t]));
  plan.jest.forEach((f) => rows.push(['jest', f]));
  if (plan.jestRelated.length) rows.push(['jest-related', plan.jestRelated.join(' ')]);
  plan.vitest.forEach((f) => rows.push(['vitest', f]));
  if (plan.vitestRelated.length) rows.push(['vitest-related', plan.vitestRelated.join(' ')]);
  if (plan.contractTests) rows.push(['contract-tests', 'packages/contract']);
  plan.toolTests.forEach((t) => rows.push(['tool-tests', t]));
  plan.nodeTests.forEach((t) => rows.push(['node-test', t]));
  plan.shellParse.forEach((t) => rows.push(['bash-n', t]));
  Object.entries(plan.eslint).forEach(([ws, fs]) => rows.push([`eslint:${ws}`, fs.join(' ')]));
  plan.smokeStrings.forEach((s) => rows.push(['smoke-string', s.replace(/[\t\n]/g, ' ')]));
  plan.skipped.forEach((s) => rows.push(['skipped', s]));
  return rows.map((r) => r.join('\t')).join('\n');
}

async function main() {
  const args = process.argv.slice(2);
  const diffAt = args.indexOf('--diff');
  const diff = diffAt >= 0 && args[diffAt + 1] ? readFileSync(args[diffAt + 1], 'utf8') : '';
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  const plan = planLaneCheck(input.split('\n'), { diff, exists: existsSync });
  process.stdout.write(args.includes('--lines') ? `${toLines(plan)}\n` : `${JSON.stringify(plan, null, 2)}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
