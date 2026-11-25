#!/usr/bin/env npx tsx
/**
 * TDB:1063 — `lineup_auto_advance_grace_ms` is ONE app-wide setting. Two
 * smoke tests set it to 3s and reset it to null (= the 5-minute default) in
 * `finally`. Run in the parallel pool, one test's reset lands while the other
 * is mid-flight: its pick arms a 5-minute grace window and the "Picking a tied
 * game edits the same tie message" poll exhausts at 60s (2 of 4 full fleet
 * runs), while a loop of the test alone passes 10/10.
 *
 * Every smoke test that touches the grace setting must therefore be `serial`
 * (run after the pool, one at a time). This is a pure source scan — no
 * Discord, API or network — so a NEW grace mutator fails here, not on CI.
 *
 * Run: npx tsx src/smoke/grace-setting-serial.spec.ts
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

const TESTS_DIR = new URL('./tests/', import.meta.url);
const GRACE_LITERAL = 'lineup_auto_advance_grace_ms';
const TEST_DECL = /const (\w+): SmokeTest = \{/g;

/** One `const X: SmokeTest = {…}` declaration and the source up to the next. */
interface TestChunk {
  file: string;
  name: string;
  body: string;
}

/** Split a test file into per-SmokeTest chunks (declaration → next one). */
function chunksOf(file: string, source: string): TestChunk[] {
  const decls = [...source.matchAll(TEST_DECL)];
  return decls.map((m, i) => {
    const next = decls[i + 1];
    return {
      file,
      name: m[1] ?? '<unnamed>',
      body: source.slice(m.index, next ? next.index : source.length),
    };
  });
}

/** True when the chunk reads or writes the grace setting. */
function touchesGrace(chunk: TestChunk, keyAlias: string | null): boolean {
  if (chunk.body.includes(GRACE_LITERAL)) return true;
  return keyAlias !== null && new RegExp(`\\b${keyAlias}\\b`).test(chunk.body);
}

/** The local const that holds the setting key (e.g. `GRACE_KEY`), if any. */
function keyAliasOf(source: string): string | null {
  const m = new RegExp(`const (\\w+) = '${GRACE_LITERAL}'`).exec(source);
  return m?.[1] ?? null;
}

const files = readdirSync(TESTS_DIR).filter((f) => f.endsWith('.test.ts'));
const mutators: TestChunk[] = [];
for (const file of files) {
  const source = readFileSync(new URL(file, TESTS_DIR), 'utf8');
  if (!source.includes(GRACE_LITERAL)) continue;
  const alias = keyAliasOf(source);
  const found = chunksOf(file, source).filter((c) => touchesGrace(c, alias));
  assert.ok(
    found.length > 0,
    `${file} mentions ${GRACE_LITERAL} but no \`const X: SmokeTest = {\` chunk ` +
      'touches it — the scan has drifted from how this file declares its tests',
  );
  mutators.push(...found);
}

assert.ok(
  mutators.length >= 2,
  `expected the tie-pick and grace-countdown tests to touch ${GRACE_LITERAL}; ` +
    `found ${mutators.length} — has the scan drifted?`,
);
const parallel = mutators.filter((c) => !/\bserial: true\b/.test(c.body));
assert.deepEqual(
  parallel.map((c) => `${c.file}::${c.name}`),
  [],
  `smoke tests that touch the app-wide ${GRACE_LITERAL} setting must be ` +
    `\`serial: true\` so one test's reset cannot land mid-way through another`,
);
console.log(
  `grace-setting-serial.spec: ${mutators.length} grace-setting tests, all serial — passed`,
);
