#!/usr/bin/env node
// ROK-2308 — guard for the Claude auto-memory index (MEMORY.md).
//
// The index once silently doubled (every line twice, 541 lines). Only the first
// 200 lines load into a session, so most of it was invisible. A Lead runs this
// at boot: it fails on an oversized, doubled or dangling index and warns on
// long lines or a heavy file.
//
//   node scripts/memory-index-check.mjs [--dir <memory dir>]
//
// Default dir: ~/.claude/projects/<slug>/memory, slug = the MAIN checkout's
// absolute path with every `/` replaced by `-` (works from any worktree).
// A missing dir prints one line and exits 0 (CI runners have no memory folder).
// Read-only: this script never writes anywhere.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const MAX_LINES = 200;
export const MAX_LINE_CHARS = 200;
export const MAX_BYTES = 25 * 1024;
const LINK_RE = /\]\(([^)\s]+\.md)\)/g;

/** Main-checkout slug: `/Users/x/Raid-Ledger` → `-Users-x-Raid-Ledger`. */
export function slugFor(mainCheckout) {
  return mainCheckout.replace(/\//g, '-');
}

function defaultDir(cwd) {
  const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
    cwd,
    encoding: 'utf8',
  }).trim();
  return join(homedir(), '.claude', 'projects', slugFor(dirname(common)), 'memory');
}

function localLinks(line) {
  return [...line.matchAll(LINK_RE)].map((m) => m[1]).filter((l) => !/^[a-z]+:/i.test(l));
}

function checkDuplicates(lines, fail) {
  const seen = new Map();
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    if (seen.has(line)) fail(`line ${i + 1} repeats line ${seen.get(line)}: ${line.slice(0, 80)}`);
    else seen.set(line, i + 1);
  });
}

function checkLinks(dir, lines, fail) {
  const linkedFrom = new Map();
  lines.forEach((line, i) => {
    for (const target of new Set(localLinks(line))) {
      if (linkedFrom.has(target)) {
        fail(`${target} is indexed twice (lines ${linkedFrom.get(target)} and ${i + 1})`);
        continue;
      }
      linkedFrom.set(target, i + 1);
      if (!existsSync(join(dir, target))) fail(`line ${i + 1} links ${target}, which does not exist`);
    }
  });
  return linkedFrom;
}

/**
 * Pure check of one memory dir. Returns { exists, fails, warns, lines, bytes }.
 * `exists` is false (and the rest empty) when the dir or MEMORY.md is absent.
 */
export function checkMemoryIndex(dir) {
  const index = join(dir, 'MEMORY.md');
  if (!existsSync(dir)) return { exists: false, fails: [], warns: [], lines: 0, bytes: 0 };
  const fails = [];
  const warns = [];
  if (!existsSync(index)) {
    return { exists: true, fails: ['MEMORY.md is missing'], warns, lines: 0, bytes: 0 };
  }
  const text = readFileSync(index, 'utf8');
  const bytes = Buffer.byteLength(text);
  const lines = text.replace(/\n$/, '').split('\n');
  const fail = (m) => fails.push(`FAIL: ${m}`);
  if (lines.length > MAX_LINES) {
    fail(`MEMORY.md has ${lines.length} lines; only the first ${MAX_LINES} load into a session`);
  }
  checkDuplicates(lines, fail);
  const linked = checkLinks(dir, lines, fail);
  const files = readdirSync(dir).filter((f) => f.endsWith('.md') && f !== 'MEMORY.md').sort();
  for (const f of files) if (!linked.has(f)) fail(`${f} has no index line in MEMORY.md`);
  lines.forEach((l, i) => {
    if (l.length > MAX_LINE_CHARS) warns.push(`WARN: line ${i + 1} is ${l.length} chars (> ${MAX_LINE_CHARS})`);
  });
  if (bytes > MAX_BYTES) warns.push(`WARN: MEMORY.md is ${bytes} bytes (> ${MAX_BYTES})`);
  return { exists: true, fails, warns, lines: lines.length, bytes };
}

function parseDir(argv) {
  const i = argv.indexOf('--dir');
  if (i < 0) return null;
  const v = argv[i + 1];
  if (!v) throw new Error('--dir needs a path');
  return resolve(v);
}

function main() {
  const dir = parseDir(process.argv.slice(2)) ?? defaultDir(process.cwd());
  const r = checkMemoryIndex(dir);
  if (!r.exists) {
    console.log(`memory-index-check: no memory dir at ${dir}, nothing to check`);
    return 0;
  }
  for (const line of [...r.fails, ...r.warns]) console.log(line);
  if (r.fails.length) return 1;
  console.log(`memory-index-check: OK — ${dir}/MEMORY.md, ${r.lines} lines, ${r.bytes} bytes`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
