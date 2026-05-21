// ROK-1331 M3 — failing tests for the frontend portions of the dashboard
// active-task render. Uses a jsdom-driven shim where possible (renderSlot
// + URL trailing-punctuation strip) and source-text assertions for the
// chunk-4 grep-style ACs (dead-code removal, CSS bump).

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const APP_JS = resolve(__dirname, '..', 'public', 'app.js');
const STYLE_CSS = resolve(__dirname, '..', 'public', 'style.css');

// Build a jsdom env and evaluate app.js source in it. The script wires up
// listeners + an initial tick; we stub fetch so the tick fails fast and the
// module's named functions are accessible on window.
const loadAppJsIntoJsdom = async () => {
  const src = await readFile(APP_JS, 'utf-8');
  const dom = new JSDOM(
    `<!doctype html><html><body>
      <span id="refresh-indicator"></span>
      <div id="env-count"></div>
      <div id="generated-at"></div>
      <div id="slots"></div>
      <div id="envs"></div>
      <div id="infra-section" style="display:none"></div>
    </body></html>`,
    {
      url: 'http://fleet.rl.lan/',
      runScripts: 'outside-only',
      pretendToBeVisual: true,
    },
  );
  const { window } = dom;
  // Stub fetch so the initial tick fails fast (no network) without throwing.
  window.fetch = () => Promise.reject(new Error('fetch stubbed for jsdom test'));
  // Eval the source. The module is currently a script, not an ES module —
  // we expose named functions via a small wrapper that re-attaches them to
  // window. The DEV implementation should add a `window.__rlTest` export
  // (or similar) gated by a test flag; until then we re-extract by source-
  // scanning the text after eval. Failing now is the TDD expectation.
  //
  // To keep the tests focused on observable behavior rather than internal
  // shape, we DO source-scan to fish out the renderSlot reference after
  // the script runs (it's defined at module scope and won't naturally
  // leak to window). The dev agent is free to either:
  //   (a) Add `window.__rlTest = { renderSlot, fmtElapsed, appendWithLinks }`
  //       behind a `if (typeof window !== 'undefined' && window.__rlTest === undefined)`
  //       guard, or
  //   (b) Refactor app.js to ESM with named exports + a build step.
  // Either makes these tests pass.
  try {
    window.eval(src);
  } catch (err) {
    // Initial tick rejection bubbles a console.warn — not a fatal eval error
    // unless the source itself throws synchronously.
    if (!/fetch stubbed/.test(String(err))) throw err;
  }
  return { window, dom };
};

// =====================================================================
// AC-M3-3 (DOM-render shape): renderSlot must emit `<ul class="slot-tasks">`
// with `<li class="task-row">` per task, or `<div class="slot-tasks-empty">`
// when the slot is claimed with no tasks. Renders nothing extra when the
// slot is unclaimed and has no tasks.
// =====================================================================
test('AC-M3-3: renderSlot emits per-task <li> rows when active_tasks ride along', async () => {
  const { window } = await loadAppJsIntoJsdom();
  assert.ok(window.__rlTest, 'app.js must expose window.__rlTest for testability');
  const { renderSlot } = window.__rlTest;
  assert.equal(typeof renderSlot, 'function', 'renderSlot must be exported via window.__rlTest');

  const slot = { slot: 1, claimed: true, agent_id: 'a1', branch: 'b1', last_heartbeat: new Date().toISOString(), web_listening: false, debug_listening: false };
  const activeTasks = [
    { task_id: 'abc12345', tool: 'rl_validate_ci', slot: 1, args_summary: '--full',
      status: 'running', started_at: new Date().toISOString(), finished_at: null, elapsed_seconds: 12 },
  ];
  const card = renderSlot(slot, activeTasks);
  const ul = card.querySelector('ul.slot-tasks');
  assert.ok(ul, 'must render <ul class="slot-tasks">');
  const li = ul.querySelectorAll('li.task-row');
  assert.equal(li.length, 1);
  assert.ok(li[0].classList.contains('task-row-running'),
    `running row must carry .task-row-running class, got ${li[0].className}`);
});

test('AC-M3-3 (empty): claimed slot + no tasks → slot-tasks-empty', async () => {
  const { window } = await loadAppJsIntoJsdom();
  const { renderSlot } = window.__rlTest;
  const slot = { slot: 1, claimed: true, agent_id: 'a1', web_listening: false, debug_listening: false };
  const card = renderSlot(slot, []);
  const empty = card.querySelector('.slot-tasks-empty');
  assert.ok(empty, 'claimed-with-no-tasks must render .slot-tasks-empty');
  assert.match(empty.textContent || '', /idle.*no tasks/i);
});

test('AC-M3-3 (idle empty): unclaimed slot + no tasks → no tasks section at all', async () => {
  const { window } = await loadAppJsIntoJsdom();
  const { renderSlot } = window.__rlTest;
  const slot = { slot: 1, claimed: false, web_listening: false, debug_listening: false };
  const card = renderSlot(slot, []);
  assert.equal(card.querySelector('.slot-tasks'), null);
  assert.equal(card.querySelector('.slot-tasks-empty'), null);
});

// =====================================================================
// AC-M3-5: terminal-status tasks render with task-row-{failed,succeeded,cancelled}
// class. Greyed style is enforced via the CSS rule (covered by style.test.js).
// Here we assert the class is applied + the correct marker glyph appears.
// =====================================================================
test('AC-M3-5: failed task row uses task-row-failed class + ✗ marker', async () => {
  const { window } = await loadAppJsIntoJsdom();
  const { renderSlot } = window.__rlTest;
  const slot = { slot: 1, claimed: true, agent_id: 'a', web_listening: false, debug_listening: false };
  const tasks = [{
    task_id: 'aaaa1111', tool: 'rl_x', slot: 1, args_summary: '',
    status: 'failed',
    started_at: new Date(Date.now() - 60_000).toISOString(),
    finished_at: new Date(Date.now() - 30_000).toISOString(),
    elapsed_seconds: 30,
  }];
  const card = renderSlot(slot, tasks);
  const row = card.querySelector('.task-row');
  assert.ok(row);
  assert.ok(row.classList.contains('task-row-failed'),
    `expected task-row-failed class, got ${row.className}`);
  const marker = row.querySelector('.task-marker');
  assert.ok(marker, 'must have .task-marker span');
  assert.equal(marker.textContent.trim(), '✗');
});

test('AC-M3-5: succeeded uses ✓, cancelled uses ⊘, running uses ▶', async () => {
  const { window } = await loadAppJsIntoJsdom();
  const { renderSlot } = window.__rlTest;
  const slot = { slot: 1, claimed: true, agent_id: 'a', web_listening: false, debug_listening: false };
  const cases = [
    { status: 'succeeded', glyph: '✓' },
    { status: 'cancelled', glyph: '⊘' },
    { status: 'running', glyph: '▶' },
  ];
  for (const { status, glyph } of cases) {
    const tasks = [{
      task_id: 'abcd1234', tool: 'rl_x', slot: 1, args_summary: '',
      status,
      started_at: new Date(Date.now() - 60_000).toISOString(),
      finished_at: status === 'running' ? null : new Date().toISOString(),
      elapsed_seconds: 60,
    }];
    const card = renderSlot(slot, tasks);
    const marker = card.querySelector('.task-marker');
    assert.ok(marker, `must have .task-marker for status=${status}`);
    assert.equal(marker.textContent.trim(), glyph,
      `status=${status} must use marker glyph "${glyph}", got "${marker.textContent.trim()}"`);
  }
});

// =====================================================================
// AC-M3-3 (log link): per-task row contains a log link pointing at the
// new endpoint, opening in a new tab.
// =====================================================================
// ROK-1337 follow-up — per-task `· log` link removed from the operator
// dashboard. Operators on LAN can hit /api/tasks/<id>/log directly; the
// public route is blocked by Traefik anyway. Keep the inverse assertion
// so a future regression putting the link back gets flagged.
test('task row does NOT render a · log link (removed in ROK-1337 follow-up)', async () => {
  const { window } = await loadAppJsIntoJsdom();
  const { renderSlot } = window.__rlTest;
  const slot = { slot: 1, claimed: true, agent_id: 'a', web_listening: false, debug_listening: false };
  const tasks = [{
    task_id: 'logtest1', tool: 'rl_x', slot: 1, args_summary: '',
    status: 'running', started_at: new Date().toISOString(), finished_at: null, elapsed_seconds: 1,
  }];
  const card = renderSlot(slot, tasks);
  assert.equal(card.querySelector('a.task-log-link'), null,
    'task-log-link should be hidden');
});

// =====================================================================
// AC-M3-13: URL trailing-punctuation strip — anchor href excludes trailing
// `.`, comma, etc.; the punctuation appears as a trailing text node.
// =====================================================================
test('AC-M3-13: trailing punctuation is stripped from anchor href', async () => {
  const { window } = await loadAppJsIntoJsdom();
  assert.ok(window.__rlTest && typeof window.__rlTest.appendWithLinks === 'function',
    'app.js must expose appendWithLinks via window.__rlTest for this test');
  const parent = window.document.createElement('div');
  window.__rlTest.appendWithLinks(parent, 'see http://example.com/foo. Then more.');
  const anchors = parent.querySelectorAll('a');
  assert.ok(anchors.length >= 1, 'must produce at least one anchor');
  // The first anchor should be the example.com URL with no trailing dot.
  assert.equal(anchors[0].getAttribute('href'), 'http://example.com/foo',
    `href must strip trailing dot, got "${anchors[0].getAttribute('href')}"`);
  // After the anchor there should be a text node starting with "." that
  // preserves the visible punctuation.
  const html = parent.innerHTML;
  assert.match(html, /<a [^>]*href="http:\/\/example\.com\/foo"[^>]*>http:\/\/example\.com\/foo<\/a>\./,
    `anchor must be immediately followed by ".", got ${html}`);
});

test('AC-M3-13 (variations): trailing ) , ; : ! ? are all stripped', async () => {
  const { window } = await loadAppJsIntoJsdom();
  const { appendWithLinks } = window.__rlTest;
  const cases = [
    { text: 'visit http://example.com/x)', expectedHref: 'http://example.com/x', expectedTrailing: ')' },
    { text: 'visit http://example.com/x,', expectedHref: 'http://example.com/x', expectedTrailing: ',' },
    { text: 'visit http://example.com/x;', expectedHref: 'http://example.com/x', expectedTrailing: ';' },
    { text: 'visit http://example.com/x:', expectedHref: 'http://example.com/x', expectedTrailing: ':' },
    { text: 'visit http://example.com/x!', expectedHref: 'http://example.com/x', expectedTrailing: '!' },
    { text: 'visit http://example.com/x?', expectedHref: 'http://example.com/x', expectedTrailing: '?' },
  ];
  for (const { text, expectedHref, expectedTrailing } of cases) {
    const parent = window.document.createElement('div');
    appendWithLinks(parent, text);
    const a = parent.querySelector('a');
    assert.ok(a, `must produce anchor for "${text}"`);
    assert.equal(a.getAttribute('href'), expectedHref,
      `href for "${text}" should be "${expectedHref}", got "${a.getAttribute('href')}"`);
    // Last node in parent should be a text node with the trailing punct.
    const lastNode = parent.childNodes[parent.childNodes.length - 1];
    assert.equal(lastNode.nodeType, /* TEXT_NODE */ 3,
      `last node for "${text}" must be a text node`);
    assert.ok((lastNode.textContent || '').endsWith(expectedTrailing),
      `last text node for "${text}" must end with "${expectedTrailing}", got "${lastNode.textContent}"`);
  }
});

// =====================================================================
// AC-M3-14: dead-code removal — `row.dataset.stepId` must not appear in app.js.
// =====================================================================
test('AC-M3-14: row.dataset.stepId dead-code removed', async () => {
  const src = await readFile(APP_JS, 'utf-8');
  assert.equal(
    src.includes('row.dataset.stepId'),
    false,
    'app.js must NOT contain row.dataset.stepId (chunk-4 dead-code removal)',
  );
});

// =====================================================================
// AC-M3-4 (server-side proxy): tested separately via Chrome MCP. Here we
// confirm renderSlot stamps `data-started-at` on running rows so the
// 1-second relabeler has the input it needs.
// =====================================================================
test('AC-M3-4 (relabel input): running .task-row has data-started-at attribute', async () => {
  const { window } = await loadAppJsIntoJsdom();
  const { renderSlot } = window.__rlTest;
  const slot = { slot: 1, claimed: true, agent_id: 'a', web_listening: false, debug_listening: false };
  const startedAt = new Date(Date.now() - 30_000).toISOString();
  const tasks = [{
    task_id: 'rrrr1111', tool: 'rl_x', slot: 1, args_summary: '',
    status: 'running', started_at: startedAt, finished_at: null, elapsed_seconds: 30,
  }];
  const card = renderSlot(slot, tasks);
  const row = card.querySelector('.task-row.task-row-running');
  assert.ok(row, 'must render .task-row.task-row-running');
  assert.equal(row.getAttribute('data-started-at'), startedAt,
    'running rows must stamp data-started-at for the relabel interval');
  // Elapsed text node must exist + be addressable for the relabeler.
  const elapsedNode = row.querySelector('.task-elapsed');
  assert.ok(elapsedNode, 'running row must contain .task-elapsed text node');
});

// =====================================================================
// fmtElapsed helper — render contract.
// =====================================================================
test('fmtElapsed: <60 → "Ns"; <3600 → "Nm Ms"; >=3600 → "Nh Mm"', async () => {
  const { window } = await loadAppJsIntoJsdom();
  assert.ok(window.__rlTest && typeof window.__rlTest.fmtElapsed === 'function',
    'app.js must expose fmtElapsed via window.__rlTest');
  const f = window.__rlTest.fmtElapsed;
  assert.equal(f(0), '0s');
  assert.equal(f(45), '45s');
  assert.equal(f(60), '1m 0s');
  assert.equal(f(192), '3m 12s');
  assert.equal(f(3599), '59m 59s');
  assert.equal(f(3600), '1h 0m');
  assert.equal(f(7320), '2h 2m');
});

// =====================================================================
// AC-M3-15 (source-level): .step-expected max-height is bumped to 12em.
// =====================================================================
test('AC-M3-15: .step-expected max-height bumped to 12em (was 7em)', async () => {
  const src = await readFile(STYLE_CSS, 'utf-8');
  // Find the .step-expected block.
  const m = src.match(/\.step-expected\s*\{([\s\S]*?)\}/);
  assert.ok(m, 'style.css must contain a .step-expected block');
  const block = m[1];
  assert.match(block, /max-height\s*:\s*12em/,
    `.step-expected max-height must be 12em, got: ${block}`);
  assert.doesNotMatch(block, /max-height\s*:\s*7em/,
    '.step-expected must NOT still carry the old 7em value');
});

// =====================================================================
// CSS scaffold check — task-row classes must exist with the expected
// terminal-status opacity rule (covers visual "greyed" requirement).
// =====================================================================
test('CSS: .task-row, .slot-tasks, .task-row-failed/succeeded/cancelled exist with opacity rule', async () => {
  const src = await readFile(STYLE_CSS, 'utf-8');
  assert.match(src, /\.slot-tasks\s*\{/, 'must define .slot-tasks selector');
  assert.match(src, /\.task-row\s*\{/, 'must define .task-row selector');
  // Terminal opacity rule:
  const failedBlock = src.match(/\.task-row\.task-row-(succeeded|failed|cancelled)[^{]*\{[^}]*\}/);
  assert.ok(failedBlock, 'must define an opacity rule for terminal task-row states');
  // The CSS spec lists them as a grouped selector with `opacity: 0.55`:
  const groupedOpacityBlock = src.match(/\.task-row\.task-row-succeeded[^{]*,[\s\S]*?\.task-row\.task-row-failed[^{]*,[\s\S]*?\.task-row\.task-row-cancelled[^{]*\{[^}]*opacity:\s*0\.55/);
  assert.ok(groupedOpacityBlock,
    'must define grouped opacity: 0.55 across task-row-succeeded/failed/cancelled');
});
