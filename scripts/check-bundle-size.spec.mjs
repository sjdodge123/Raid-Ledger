/**
 * Unit spec for the ROK-1154 bundle-size budget gate (check-bundle-size.mjs).
 * node:test like the other `scripts/*.spec.mjs` (ESM `.mjs` outside a
 * workspace). Builds synthetic `dist/` fixtures in a temp dir; chunk bodies
 * are random bytes so their gzip size is ~their raw size.
 *
 *   node --test scripts/check-bundle-size.spec.mjs
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { after, afterEach, test } from 'node:test';

import realBudgets, { BASELINE_KB, HEADROOM } from './bundle-budget.config.mjs';
import { checkBundle, gzipSize, parseIndexHtml, stableName } from './check-bundle-size.mjs';

const CHECKER = path.join(path.dirname(fileURLToPath(import.meta.url)), 'check-bundle-size.mjs');
const KB = 1024;
const tmpDirs = [];

afterEach(() => {
  while (tmpDirs.length) fs.rmSync(tmpDirs.pop(), { recursive: true, force: true });
});

/** Fixture budgets, written as a real config module so the CLI can load it. */
const CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'bundle-budget-config-'));
const CONFIG = path.join(CONFIG_DIR, 'budget.config.mjs');
fs.writeFileSync(CONFIG, `export default {
  entryKB: 4,
  totalInitialKB: 20,
  vendorGroupsKB: { 'react-vendor': 4, sentry: 5 },
  lazyDefaultKB: 2,
  lazyOverrides: [
    { name: 'big-page', budgetKB: 6 },
    { pattern: /^chunk-[A-Z0-9]{8}$/, label: 'chunk-*', budgetKB: 3 },
  ],
};\n`);
const BUDGETS = (await import(pathToFileURL(CONFIG).href)).default;
after(() => fs.rmSync(CONFIG_DIR, { recursive: true, force: true }));

/** Chunk sizes in KB (random bytes, so gzip ≈ raw), all within BUDGETS. */
const CLEAN = {
  'index-AAAAAAAA.js': 3,
  'react-vendor-BBBBBBBB.js': 3,
  'sentry-CCCCCCCC.js': 2,
  'sentry-DDDD_-DD.js': 2,
  'chunk-QWERTY12-EEEEEEEE.js': 2,
  'big-page-FFFFFFFF.js': 5,
  'small-page-GGGGGGGG.js': 1,
  // CSS: index.html links index-*.css; the route stylesheet is lazy.
  'index-ZZZZZZZZ.css': 1,
  'lazy-route-YYYYYYYY.css': 1,
};
const EAGER = ['react-vendor-BBBBBBBB.js', 'sentry-CCCCCCCC.js', 'chunk-QWERTY12-EEEEEEEE.js'];

const indexHtml = (entry, preloads) => [
  '<!doctype html><html><head>',
  '<script>window.inline = 1</script>',
  '<script src="https://example.com/external.js" async></script>',
  `<script type="module" crossorigin src="/assets/${entry}"></script>`,
  ...preloads.map((f) => `<link rel="modulepreload" crossorigin href="/assets/${f}">`),
  '<link rel="stylesheet" crossorigin href="/assets/index-ZZZZZZZZ.css">',
  '</head><body></body></html>',
].join('\n');

function makeDist(chunks = CLEAN, { entry = 'index-AAAAAAAA.js', preloads = EAGER, html = true } = {}) {
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'bundle-budget-'));
  tmpDirs.push(dist);
  fs.mkdirSync(path.join(dist, 'assets'));
  for (const [file, kb] of Object.entries(chunks)) {
    fs.writeFileSync(path.join(dist, 'assets', file), crypto.randomBytes(Math.round(kb * KB)));
  }
  fs.writeFileSync(path.join(dist, 'assets', 'index-AAAAAAAA.js.map'), crypto.randomBytes(50 * KB));
  if (html) fs.writeFileSync(path.join(dist, 'index.html'), indexHtml(entry, preloads));
  return dist;
}

/** Runs the real CLI against `dist` with the fixture budgets. */
function runCli(dist) {
  return spawnSync(process.execPath, [CHECKER, '--dist', dist, '--config', CONFIG], { encoding: 'utf8' });
}

const gz = (dist, file) => gzipSize(fs.readFileSync(path.join(dist, 'assets', file)));
const rowFor = (result, cls, chunk) => result.rows.find((r) => r.cls === cls && r.chunk.startsWith(chunk));

test('stableName strips the 8-char rolldown hash, including - and _ in it', () => {
  assert.equal(stableName('use-debounced-value-CZQ65Gz-.js'), 'use-debounced-value');
  assert.equal(stableName('chunk-BV7QT456-DU2Pp8La.js'), 'chunk-BV7QT456');
  assert.equal(stableName('sentry-DDDD_-DD.js'), 'sentry');
  assert.equal(stableName('ndt7-worker.js'), 'ndt7-worker');
});

test('parseIndexHtml finds the module entry and modulepreloads only', () => {
  const { entry, eager, css } = parseIndexHtml(indexHtml('index-AAAAAAAA.js', EAGER));
  assert.equal(entry, 'index-AAAAAAAA.js');
  assert.deepEqual(eager, ['index-AAAAAAAA.js', ...EAGER]);
  assert.deepEqual(css, ['index-ZZZZZZZZ.css'], 'the linked stylesheet is eager CSS');
});

test('an under-budget build exits 0 and prints the table', () => {
  const res = runCli(makeDist());
  assert.equal(res.status, 0, `expected exit 0, got ${res.status}\n${res.stdout}${res.stderr}`);
  assert.match(res.stdout, /chunk\s+class\s+gzip KB\s+budget KB\s+headroom/);
  assert.match(res.stdout, /PASS/);
});

test('a synthetic entry regression over budget exits 1 and names the chunk', () => {
  const res = runCli(makeDist({ ...CLEAN, 'index-AAAAAAAA.js': 6 }));
  assert.equal(res.status, 1, `expected exit 1 for a 6 KB entry vs 4 KB budget, got ${res.status}\n${res.stdout}`);
  assert.match(res.stderr, /FAIL — 1 over budget: index-AAAAAAAA\.js/);
  assert.match(res.stdout, /index-AAAAAAAA\.js\s+entry\s+6\.\d\s+4\.0\s+OVER by/);
});

test('a missing dist, index.html or assets dir exits 1', () => {
  const noHtml = makeDist(CLEAN, { html: false });
  const noAssets = makeDist();
  fs.rmSync(path.join(noAssets, 'assets'), { recursive: true });
  for (const [label, dist, msg] of [
    ['missing dist', path.join(noHtml, 'does-not-exist'), /missing .*does-not-exist.*index\.html/],
    ['missing index.html', noHtml, /missing .*index\.html/],
    ['missing assets', noAssets, /missing .*assets/],
  ]) {
    const res = runCli(dist);
    assert.equal(res.status, 1, `${label}: expected exit 1, got ${res.status}\n${res.stdout}${res.stderr}`);
    assert.match(res.stderr, msg, `${label}: wrong error`);
  }
});

test('the eager total sums the entry, every modulepreload and linked CSS, not lazy chunks', () => {
  const dist = makeDist();
  const result = checkBundle(dist, BUDGETS);
  const eagerFiles = ['index-AAAAAAAA.js', ...EAGER, 'index-ZZZZZZZZ.css'];
  const expected = eagerFiles.reduce((sum, f) => sum + gz(dist, f), 0);
  assert.equal(result.eagerTotalBytes, expected, 'eager total must be entry + preloads + linked CSS only');
  assert.equal(result.cssBytes, gz(dist, 'index-ZZZZZZZZ.css'), 'only the linked stylesheet counts as CSS');
  assert.equal(rowFor(result, 'total', 'initial load').bytes, expected);
  assert.match(rowFor(result, 'total', 'initial load').chunk, /\[4 js \+ 1 css\]/);
  assert.ok(!result.failures.length, `clean fixture failed: ${result.failures.map((r) => r.chunk)}`);
});

test('the total budget fails even when every chunk is within its own budget', () => {
  const result = checkBundle(makeDist(), { ...BUDGETS, totalInitialKB: 8 });
  assert.deepEqual(result.failures.map((r) => r.cls), ['total'], 'only the total row should fail');
});

test('linked CSS alone can push the initial load over budget; unlinked CSS never counts', () => {
  // JS eager is 10 KB of the 20 KB total budget: a 12 KB linked stylesheet
  // overruns it, while a 30 KB lazy route stylesheet (not linked) must not.
  const overCss = checkBundle(makeDist({ ...CLEAN, 'index-ZZZZZZZZ.css': 12 }), BUDGETS);
  assert.deepEqual(overCss.failures.map((r) => r.cls), ['total'], 'a 12 KB linked stylesheet must fail the total');
  const bigLazyCss = checkBundle(makeDist({ ...CLEAN, 'lazy-route-YYYYYYYY.css': 30 }), BUDGETS);
  assert.deepEqual(bigLazyCss.failures, [], 'an unlinked stylesheet must not count toward the initial load');
  const noCss = { ...CLEAN };
  delete noCss['index-ZZZZZZZZ.css'];
  assert.throws(() => checkBundle(makeDist(noCss), BUDGETS), /missing asset\(s\): index-ZZZZZZZZ\.css/);
});

test('the two sentry-* chunks are summed and budgeted as one vendor group', () => {
  const dist = makeDist({ ...CLEAN, 'sentry-DDDD_-DD.js': 3.5 });
  const result = checkBundle(dist, BUDGETS);
  const sentry = rowFor(result, 'vendor', 'sentry [2 files]');
  assert.ok(sentry, 'expected one vendor row for the sentry group');
  assert.equal(sentry.bytes, gz(dist, 'sentry-CCCCCCCC.js') + gz(dist, 'sentry-DDDD_-DD.js'));
  assert.equal(sentry.ok, false, `2 + 3.5 KB sentry group must exceed its 5 KB budget`);
});

test('lazy chunks use named/pattern budgets, else the default cap', () => {
  const dist = makeDist({ ...CLEAN, 'brand-new-page-HHHHHHHH.js': 2.5 });
  const result = checkBundle(dist, BUDGETS);
  assert.equal(rowFor(result, 'lazy', 'big-page').budgetKB, 6);
  assert.equal(rowFor(result, 'shared', 'chunk-QWERTY12').budgetKB, 3);
  assert.equal(rowFor(result, 'lazy', 'small-page').budgetKB, 2);
  assert.deepEqual(result.failures.map((r) => r.chunk), ['brand-new-page-HHHHHHHH.js']);
  assert.deepEqual(result.hints, [], 'every named entry matched, so there is no rename to suggest');
});

test('a budget entry that matches no chunk is reported as a warning', () => {
  const withoutBigPage = { ...CLEAN };
  delete withoutBigPage['big-page-FFFFFFFF.js'];
  const result = checkBundle(makeDist(withoutBigPage), BUDGETS);
  assert.ok(result.warnings.some((n) => n.includes('"big-page" matched no chunk')), result.warnings.join('\n'));
});

test('a renamed named chunk: WARN names the stale entry and the FAIL says which entry to rename', () => {
  const renamed = { ...CLEAN, 'big-page-v2-FFFFFFFF.js': 5 };
  delete renamed['big-page-FFFFFFFF.js'];
  const res = runCli(makeDist(renamed));
  assert.equal(res.status, 1, `a 5 KB chunk on the 2 KB default cap must fail, got ${res.status}\n${res.stdout}`);
  assert.match(res.stdout, /^WARN: budget entry "big-page" matched no chunk/m);
  assert.match(res.stderr, /FAIL — 1 over budget: big-page-v2-FFFFFFFF\.js/);
  assert.match(res.stderr, /^hint: big-page-v2-FFFFFFFF\.js is on the default lazy cap while "big-page" matched no chunk/m);
});

test('real budgets are the 2026-09-26 baseline + 15%, rounded up', () => {
  assert.equal(HEADROOM, 1.15);
  assert.ok(realBudgets.entryKB >= BASELINE_KB.entry * HEADROOM);
  assert.ok(realBudgets.totalInitialKB >= BASELINE_KB.totalInitial * HEADROOM);
  for (const [group, kb] of Object.entries(BASELINE_KB.vendor)) {
    assert.ok(realBudgets.vendorGroupsKB[group] >= kb * HEADROOM, `${group} budget below baseline+15%`);
    assert.ok(realBudgets.vendorGroupsKB[group] < kb * HEADROOM + 0.1, `${group} budget above baseline+15%`);
  }
  for (const o of realBudgets.lazyOverrides) {
    assert.ok(o.budgetKB >= o.baselineKB * HEADROOM && o.budgetKB < o.baselineKB * HEADROOM + 0.1, o.name ?? o.label);
  }
});
