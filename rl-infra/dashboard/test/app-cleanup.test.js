// ROK-1331 M6b chunk-4 — app.js + style.css cleanup.
//
// Four assertions against the dashboard frontend source:
//   1. app.js URL_RE (~line 33) strips trailing punctuation .,;:!?) — today
//      the regex `/(https?:\/\/[^\s<>'"`)]+)/g` greedily eats trailing
//      periods/commas/etc. in prose like "see https://example.com." which
//      then become part of the href.
//   2. app.js:406 `row.dataset.stepId = String(step.id);` line is REMOVED.
//      patchPlanInPlace iterates plan.steps by INDEX against
//      [...document.querySelectorAll('.plan-step')] — the dataset is set but
//      never read.
//   3. app.js:485 `patchPlanInPlace` (or the `pendingReset` read near line
//      485) gains an explanatory comment that documents WHY pendingReset is
//      read from the CSS class and not the plan data.
//   4. style.css `.step-expected` `max-height` raised from 7em → 12em for
//      iOS Safari scrollbar affordance.
//
// These tests MUST fail today against the unmodified source.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const APP_JS = resolve(__dirname, '..', 'public', 'app.js');
const STYLE_CSS = resolve(__dirname, '..', 'public', 'style.css');

// AC-M6b-17: URL_RE strips trailing punctuation . , ; : ! ? )
// We evaluate the regex from the source by extracting it, then run a tiny
// fixture through the same split-and-test pattern app.js uses.
test('AC-M6b-17: URL_RE strips trailing .,;:!?) from auto-linkified URLs', () => {
  const src = readFileSync(APP_JS, 'utf-8');
  // Pull URL_RE definition out of the source.
  const m = src.match(/const URL_RE\s*=\s*(\/[^\n]+\/g)\s*;/);
  assert.ok(m, 'expected `const URL_RE = /.../g;` in app.js');
  // Build a live RegExp from the source literal. The literal includes the
  // leading slash + flags suffix — eval-via-Function in a controlled way.
  // The regex shape stays simple (one capture group, /g flag), so this is
  // a safe parse for a test fixture (NEVER for runtime user input).
  const literal = m[1];
  // eslint-disable-next-line no-new-func
  const re = Function(`"use strict"; return ${literal};`)();
  assert.ok(re instanceof RegExp, 'literal must compile to RegExp');

  // Fixture: prose that ends with trailing punctuation immediately after
  // a URL. After split, the captured URL token must NOT contain the
  // trailing punctuation char.
  const cases = [
    { text: 'see https://example.com.', url: 'https://example.com' },
    { text: 'see https://example.com, ok', url: 'https://example.com' },
    { text: 'see https://example.com! ok', url: 'https://example.com' },
    { text: 'see https://example.com?ok', url: 'https://example.com' },  // ? is valid in URL — keep
    { text: '(https://example.com)', url: 'https://example.com' },
    { text: 'https://example.com;', url: 'https://example.com' },
    { text: 'https://example.com:', url: 'https://example.com' },
  ];
  for (const { text, url } of cases) {
    const parts = text.split(re);
    // The captured URL must appear EXACTLY as `url` (without the trailing
    // punctuation) in the parts array. The current greedy regex would
    // include the dot/comma/etc.
    const found = parts.find((p) => p && /^https?:\/\//.test(p));
    if (text === 'see https://example.com?ok') {
      // `?` inside a URL query-string is legitimate; we don't strip it
      // mid-URL. The current regex would already match this correctly.
      assert.ok(found && found.startsWith('https://example.com'), `kept ?-style URL: ${text}`);
      continue;
    }
    assert.equal(found, url, `trailing punctuation must be stripped for: ${text}`);
  }
});

// AC-M6b-18: app.js line ~406 `row.dataset.stepId = String(step.id);` is GONE.
test('AC-M6b-18: row.dataset.stepId line is removed from app.js', () => {
  const src = readFileSync(APP_JS, 'utf-8');
  assert.doesNotMatch(
    src,
    /row\.dataset\.stepId\s*=/,
    '`row.dataset.stepId = ...` must be removed — it is set but never read (patchPlanInPlace iterates by index)',
  );
});

// AC-M6b-19: patchPlanInPlace gains an explanatory comment about the
// pendingReset-from-class read. The spec requires a multi-line block that
// explains WHY pendingReset is read from the CSS class and not the plan
// data — specifically mentioning that reset signals only arrive via re-
// render. The existing one-line comment ("pendingReset stays as the server
// told us") is NOT sufficient — it says WHAT, not WHY.
test('AC-M6b-19: patchPlanInPlace pendingReset read has explanatory WHY comment', () => {
  const src = readFileSync(APP_JS, 'utf-8');
  const lines = src.split('\n');
  const idx = lines.findIndex(
    (l) => /pendingReset\s*=\s*row\.classList\.contains\(['"]reset-pending['"]\)/.test(l),
  );
  assert.ok(idx > -1, 'expected pendingReset read in patchPlanInPlace');
  // Look at the 8 preceding lines for a comment block that mentions BOTH
  // the WHY ("re-render" / "patch path" / "pure-DOM") AND "class" — the
  // spec's required explanation, not the today-existing WHAT line.
  const preceding = lines.slice(Math.max(0, idx - 8), idx).join('\n');
  const mentionsWhy = /(re-render|patch path|pure-DOM|live-pushed|plan data)/i.test(preceding);
  const mentionsClass = /(CLASS|class\b)/i.test(preceding);
  assert.ok(
    mentionsWhy && mentionsClass,
    `expected WHY-style explanatory block above pendingReset read (must mention re-render/patch-path + class). Got:\n${preceding}`,
  );
});

// AC-M6b-20: style.css .step-expected max-height is 12em (was 7em).
test('AC-M6b-20: .step-expected max-height bumped to 12em', () => {
  const src = readFileSync(STYLE_CSS, 'utf-8');
  // Find the .step-expected rule and inspect its max-height value.
  const m = src.match(/\.step-expected\s*\{([\s\S]*?)\}/);
  assert.ok(m, '.step-expected rule must exist in style.css');
  const block = m[1];
  assert.match(block, /max-height\s*:\s*12em\b/, '.step-expected max-height must be 12em');
  assert.doesNotMatch(block, /max-height\s*:\s*7em\b/, '.step-expected must NOT still be 7em');
});

// AC-M6b-21: listener-attach gains the M6b-required one-line comment block
// at 391-393 explicitly explaining that the attach is safe BECAUSE
// `replaceChildren` discards prior nodes and GC handles the listeners (the
// spec's required text). Today's source has a different ROK-1326 fix-9
// comment block — close-but-not-identical and missing the GC explanation.
// Tighten to require BOTH "GC" (or "garbage") AND "replaceChildren" (or
// "discard") so the spec-required addition is enforced.
test('AC-M6b-21: listener-attach comment explains GC + replaceChildren semantics', () => {
  const src = readFileSync(APP_JS, 'utf-8');
  const lines = src.split('\n');
  const idx = lines.findIndex(
    (l) => /passBtn\.addEventListener\(['"]click['"]/.test(l),
  );
  assert.ok(idx > -1, 'expected passBtn click handler binding');
  const preceding = lines.slice(Math.max(0, idx - 10), idx).join('\n');
  const mentionsGc = /(GC|garbage|gc handles)/i.test(preceding);
  const mentionsReplace = /(replaceChildren|discard|prior nodes)/i.test(preceding);
  assert.ok(
    mentionsGc && mentionsReplace,
    `expected M6b listener-attach comment (must mention GC + replaceChildren/discard). Got:\n${preceding}`,
  );
});
