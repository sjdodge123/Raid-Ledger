// ROK-2171 review fixes — build-reclaim.mjs on its own (no guard.mjs, so no
// dockerfile-ast): M1 a still-tagged predecessor is kept, m2 a stalled snapshot
// is bounded, m3 a build that starts during the checks keeps the image, and the
// in-flight count drops exactly once.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { beginBuild, buildsInFlight, setSnapshotTimeoutMs, setDeleteTimeoutMs } from '../src/build-reclaim.mjs';

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'reclaim-2171-'));
after(() => fs.rmSync(scratch, { recursive: true, force: true }));
const OLD = `sha256:${'a'.repeat(64)}`;
const NEW = `sha256:${'b'.repeat(64)}`;

/**
 * `rl:ci-test` points at OLD until `moveTag()`. opts: oldTags (OLD's RepoTags
 * after the move), stallSnapshot (the first GET of rl:ci-test never answers),
 * onContainers (hook run when the container list is read), oldTagsByInspect
 * (OLD's RepoTags per successive inspect by ID), holdDelete (DELETE answers only
 * after releaseDelete()).
 */
async function fakeDaemon(opts = {}) {
  const sock = path.join(fs.mkdtempSync(path.join(scratch, 'd-')), 'd.sock');
  const seen = [];
  let current = OLD;
  let snapshots = 0;
  let oldInspects = 0;
  let releaseDelete;
  const deleteHeld = new Promise((r) => { releaseDelete = r; });
  const send = (res, status, body) => { res.statusCode = status; res.end(JSON.stringify(body)); };
  const daemon = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url ?? '');
    seen.push(`${req.method} ${url}`);
    if (req.method === 'GET' && url === '/images/rl:ci-test/json') {
      snapshots += 1;
      if (opts.stallSnapshot && snapshots === 1) return; // never answers
      return send(res, 200, { Id: current, RepoTags: ['rl:ci-test'], Config: { Labels: {} } });
    }
    if (req.method === 'GET' && url === `/images/${OLD}/json`) {
      oldInspects += 1;
      const tags = opts.oldTagsByInspect?.[oldInspects - 1] ?? opts.oldTags ?? [];
      return send(res, 200, { Id: OLD, RepoTags: tags, Config: { Labels: {} } });
    }
    if (url.startsWith('/containers/json')) {
      opts.onContainers?.();
      return send(res, 200, []);
    }
    if (req.method === 'DELETE') {
      if (opts.holdDelete) return deleteHeld.then(() => send(res, 200, [{ Deleted: OLD }]));
      return send(res, 200, [{ Deleted: OLD }]);
    }
    send(res, 404, { message: 'no such object' });
  });
  await new Promise((r) => daemon.listen(sock, r));
  return { sock, seen, moveTag: () => { current = NEW; }, releaseDelete: () => releaseDelete(), close: () => { daemon.closeAllConnections(); daemon.close(); } };
}

const deletes = (d) => d.seen.filter((s) => s.startsWith('DELETE'));

/** One rl:ci-test build through the module: snapshot, the tag moves, end(true). */
async function rebuild(d, lines) {
  const end = await beginBuild(d.sock, ['rl:ci-test'], (m) => lines.push(m));
  d.moveTag();
  await end(true);
}

test('M1: the previous image still carrying another tag is kept, no DELETE sent', async () => {
  const d = await fakeDaemon({ oldTags: ['registry.rl.lan:5000/rl-allinone:rok-1'] });
  const lines = [];
  try { await rebuild(d, lines); } finally { d.close(); }
  assert.deepEqual(deletes(d), [], `an env image tagged alongside rl:ci-test must survive, saw ${JSON.stringify(d.seen)}`);
  assert.deepEqual(lines, [`RECLAIM kept previous rl:ci-test ${OLD}: still tagged registry.rl.lan:5000/rl-allinone:rok-1`]);
  assert.equal(buildsInFlight(), 0);
});

test('M1: the previous image with no tags left (or only <none>:<none>) is removed', async () => {
  for (const oldTags of [[], ['<none>:<none>']]) {
    const d = await fakeDaemon({ oldTags });
    const lines = [];
    try { await rebuild(d, lines); } finally { d.close(); }
    assert.deepEqual(deletes(d), [`DELETE /images/${OLD}`], `oldTags=${JSON.stringify(oldTags)}: an untagged predecessor is reclaimed`);
    assert.deepEqual(lines, [`RECLAIM removed previous rl:ci-test ${OLD}`]);
  }
});

test('m2: a stalled snapshot gives up after the timeout; the build goes on and nothing is removed', async () => {
  const d = await fakeDaemon({ stallSnapshot: true });
  const lines = [];
  setSnapshotTimeoutMs(50);
  let outcome;
  try {
    const stalled = new Promise((r) => { setTimeout(() => r('still waiting after 2000 ms'), 2000).unref(); });
    outcome = await Promise.race([rebuild(d, lines).then(() => 'finished'), stalled]);
  } finally { setSnapshotTimeoutMs(0); d.close(); }
  assert.equal(outcome, 'finished', 'the snapshot must be bounded by its timeout, not wait on a stalled daemon');
  assert.deepEqual(deletes(d), [], 'no snapshot, no reclaim');
  assert.match(lines.join('\n'), /RECLAIM snapshot of rl:ci-test unavailable \(timeout or daemon error\)/);
  assert.equal(buildsInFlight(), 0);
});

test('m3: a build that starts during the safety checks keeps the previous image', async () => {
  let other = null;
  const d = await fakeDaemon({ onContainers: () => { other ??= beginBuild('/nonexistent.sock', ['rl:other'], () => {}); } });
  const lines = [];
  try { await rebuild(d, lines); } finally { d.close(); }
  assert.deepEqual(deletes(d), [], 'a build counted in flight right before DELETE must stop it');
  assert.match(lines.join('\n'), /kept previous rl:ci-test .*1 other build\(s\) in flight/);
  assert.ok(other !== null, 'the hook ran');
  (await other)(false);
  assert.equal(buildsInFlight(), 0);
});

test('end() called twice drops the in-flight count once', async () => {
  const before = buildsInFlight();
  const end = await beginBuild('/nonexistent.sock', ['rl:other'], () => {});
  assert.equal(buildsInFlight(), before + 1);
  await end(false);
  await end(false);
  assert.equal(buildsInFlight(), before);
});

test('Codex P2: a build that begins while the DELETE runs is admitted only after it finishes', async () => {
  const d = await fakeDaemon({ holdDelete: true });
  const lines = [];
  let admitted = false;
  let next = null;
  try {
    const end = await beginBuild(d.sock, ['rl:ci-test'], (m) => lines.push(m));
    d.moveTag();
    const removal = end(true);
    for (let i = 0; i < 400 && deletes(d).length === 0; i += 1) await new Promise((r) => setTimeout(r, 5));
    assert.deepEqual(deletes(d), [`DELETE /images/${OLD}`], 'the DELETE was dispatched');
    next = beginBuild('/nonexistent.sock', ['rl:other'], () => {}).then((e) => { admitted = true; return e; });
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(admitted, false, 'a build admitted while the DELETE (and its cache-parent removal) is still running');
    d.releaseDelete();
    await removal;
    (await next)(false);
    assert.equal(admitted, true, 'the waiting build is admitted once the DELETE finished');
  } finally { d.releaseDelete(); d.close(); }
  assert.deepEqual(lines, [`RECLAIM removed previous rl:ci-test ${OLD}`]);
  assert.equal(buildsInFlight(), 0);
});

test('delta minor: a tag added to the previous image during the checks keeps it, no DELETE', async () => {
  const d = await fakeDaemon({ oldTagsByInspect: [[], ['registry.rl.lan:5000/rl-allinone:rok-9']] });
  const lines = [];
  try { await rebuild(d, lines); } finally { d.close(); }
  assert.deepEqual(deletes(d), [], `re-inspected right before DELETE, the new tag must keep it; saw ${JSON.stringify(d.seen)}`);
  assert.deepEqual(lines, [`RECLAIM kept previous rl:ci-test ${OLD}: still tagged registry.rl.lan:5000/rl-allinone:rok-9`]);
});

// ---- Fix 3 (delta review + Codex r2): every in-flight DELETE, bounded DELETE, env fallbacks ----
const MID = `sha256:${'c'.repeat(64)}`;
const tick = (ms) => new Promise((r) => { setTimeout(r, ms); });
async function until(cond, what) {
  for (let i = 0; i < 400 && !cond(); i += 1) await tick(5);
  assert.ok(cond(), `timed out waiting for ${what}`);
}

/**
 * `rl:ci-test` points at `current`; every image ID inspects untagged. DELETEs
 * answer only after release(id) (or never, with neverAnswerDelete); the FIRST
 * container-list read answers only after releaseContainers().
 */
async function holdingDaemon(opts = {}) {
  const sock = path.join(fs.mkdtempSync(path.join(scratch, 'h-')), 'd.sock');
  const seen = [];
  let current = OLD;
  const holds = new Map();
  const hold = (id) => { if (!holds.has(id)) { let r; holds.set(id, { p: new Promise((x) => { r = x; }), r }); } return holds.get(id); };
  let releaseContainers;
  const containersHeld = new Promise((r) => { releaseContainers = r; });
  let containerReads = 0;
  const send = (res, status, body) => { res.statusCode = status; res.end(JSON.stringify(body)); };
  const daemon = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url ?? '');
    seen.push(`${req.method} ${url}`);
    if (req.method === 'GET' && url === '/images/rl:ci-test/json') return send(res, 200, { Id: current, RepoTags: ['rl:ci-test'], Config: { Labels: {} } });
    const m = /^\/images\/(sha256:[a-f0-9]+)(\/json)?$/.exec(url);
    if (req.method === 'GET' && m) return send(res, 200, { Id: m[1], RepoTags: [], Config: { Labels: {} } });
    if (url.startsWith('/containers/json')) {
      containerReads += 1;
      if (opts.holdFirstContainers && containerReads === 1) return containersHeld.then(() => send(res, 200, []));
      return send(res, 200, []);
    }
    if (req.method === 'DELETE' && m) {
      if (opts.neverAnswerDelete) return undefined;
      return hold(m[1]).p.then(() => send(res, 200, [{ Deleted: m[1] }]));
    }
    return send(res, 404, { message: 'no such object' });
  });
  await new Promise((r) => daemon.listen(sock, r));
  return {
    sock, seen,
    setCurrent: (id) => { current = id; },
    release: (id) => hold(id).r(),
    releaseContainers: () => releaseContainers(),
    close: () => { for (const h of holds.values()) h.r(); releaseContainers(); daemon.closeAllConnections(); daemon.close(); },
  };
}

test('fix 3: a build waits for EVERY in-flight DELETE, not only the last one dispatched', async () => {
  const d = await holdingDaemon({ holdFirstContainers: true });
  const lines = [];
  const log = (m) => lines.push(m);
  let admitted = false;
  try {
    const endA = await beginBuild(d.sock, ['rl:ci-test'], log); // snapshot OLD
    d.setCurrent(MID);
    const remA = endA(true); // removal of OLD parks on the container list
    await until(() => d.seen.some((s) => s.startsWith('GET /containers/json')), 'A to reach the container check');
    const endB = await beginBuild(d.sock, ['rl:ci-test'], log); // snapshot MID
    d.setCurrent(NEW);
    const remB = endB(true); // DELETE MID dispatched first, held
    await until(() => deletes(d).includes(`DELETE /images/${MID}`), 'the DELETE of MID');
    d.releaseContainers(); // A goes on: DELETE OLD dispatched second, held
    await until(() => deletes(d).includes(`DELETE /images/${OLD}`), 'the DELETE of OLD');
    d.release(OLD); // the LAST dispatched DELETE finishes, MID's is still running
    await remA;
    const next = beginBuild('/nonexistent.sock', ['rl:other'], () => {}).then((e) => { admitted = true; return e; });
    await tick(50);
    assert.equal(admitted, false, 'a build was admitted while an earlier DELETE (MID) was still running');
    d.release(MID);
    await remB;
    (await next)(false);
    assert.equal(admitted, true, 'the waiting build is admitted once every DELETE finished');
  } finally { d.close(); }
  assert.deepEqual(lines.sort(), [`RECLAIM removed previous rl:ci-test ${MID}`, `RECLAIM removed previous rl:ci-test ${OLD}`].sort());
  assert.equal(buildsInFlight(), 0);
});

test('fix 3: a DELETE that never answers is bounded; it is logged as kept and later builds go on', async () => {
  const d = await holdingDaemon({ neverAnswerDelete: true });
  const lines = [];
  setDeleteTimeoutMs(50);
  let outcome;
  try {
    const stalled = new Promise((r) => { setTimeout(() => r('still waiting after 2000 ms'), 2000).unref(); });
    const run = async () => {
      const end = await beginBuild(d.sock, ['rl:ci-test'], (m) => lines.push(m));
      d.setCurrent(NEW);
      await end(true);
      (await beginBuild('/nonexistent.sock', ['rl:other'], () => {}))(false);
      return 'finished';
    };
    outcome = await Promise.race([run(), stalled]);
  } finally { setDeleteTimeoutMs(0); d.close(); }
  assert.equal(outcome, 'finished', 'a stalled removal DELETE must not wedge the next guarded build');
  assert.deepEqual(deletes(d), [`DELETE /images/${OLD}`]);
  assert.deepEqual(lines, [`RECLAIM kept previous rl:ci-test ${OLD}: DELETE unanswered after 50 ms (timeout or daemon error; dangling_prune reclaims it)`]);
  assert.equal(buildsInFlight(), 0);
});

test('fix 3: a negative, zero or non-numeric timeout env value falls back to the default', () => {
  const mod = fileURLToPath(new URL('../src/build-reclaim.mjs', import.meta.url));
  const script = `const m = await import(${JSON.stringify(mod)}); console.log(JSON.stringify(m.reclaimTimeouts()));`;
  for (const v of ['-5', '0', 'soon']) {
    const env = { ...process.env, RL_GUARD_RECLAIM_SNAPSHOT_TIMEOUT_MS: v, RL_GUARD_RECLAIM_DELETE_TIMEOUT_MS: v };
    const got = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], { env, encoding: 'utf8' }));
    assert.deepEqual(got, { snapshotMs: 4000, deleteMs: 60000 }, `env value ${JSON.stringify(v)} must fall back to the defaults`);
  }
  const env = { ...process.env, RL_GUARD_RECLAIM_SNAPSHOT_TIMEOUT_MS: '250', RL_GUARD_RECLAIM_DELETE_TIMEOUT_MS: '9000' };
  const got = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], { env, encoding: 'utf8' }));
  assert.deepEqual(got, { snapshotMs: 250, deleteMs: 9000 }, 'a positive env value is used');
});
