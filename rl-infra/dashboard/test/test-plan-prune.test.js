// ROK-1346 — stale test-plan pruner.
//
// When a NEW env registers (the live-env slug set gains a member), the
// dashboard clears test plans for any slug with no live env, so testers stop
// seeing a retired story's plans on a freshly-claimed slot. Critically it must
// NOT prune on a bare env removal (env-destroy), so tester progress survives a
// same-slug redeploy (feedback_rl_fleet_destroy_preserves_plans).
//
// Trigger is the /api/state poll (the dashboard already reads env-registry.json
// there). This test drives the registry through:
//   1. [active, stale]      → first poll = baseline, no prune
//   2. [active]             → removal only, NO prune (stale plan survives)
//   3. [active, fresh]      → addition → prune the now-orphaned `stale`
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SERVER_PATH = resolve(__dirname, '..', 'server.js');
const PUBLIC_DIR = resolve(__dirname, '..', 'public');

const exists = async (p) => {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
};

const writeRegistry = (stateDir, slugs) =>
  writeFile(
    join(stateDir, 'env-registry.json'),
    JSON.stringify(slugs.map((slug) => ({ slug }))),
  );

const startServer = async (stateDir) => {
  const plansDir = join(stateDir, 'test-plans');
  await writeFile(
    join(stateDir, 'claims.json'),
    JSON.stringify([{ slot: 1, claimed: false }]),
  );
  const child = spawn(process.execPath, [SERVER_PATH], {
    env: {
      ...process.env,
      PORT: '0',
      STATE_DIR: stateDir,
      TEST_PLANS_DIR: plansDir,
      PUBLIC_DIR,
      NODE_ENV: 'test',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let port = null;
  let stderrBuf = '';
  let stdoutBuf = '';
  await new Promise((res, rej) => {
    child.stdout.on('data', (c) => {
      stdoutBuf += c.toString('utf-8');
      const m = stdoutBuf.match(/listening on :(\d+)/);
      if (m && !port) {
        port = parseInt(m[1], 10);
        res();
      }
    });
    child.stderr.on('data', (c) => (stderrBuf += c.toString('utf-8')));
    child.once('error', rej);
    child.once('exit', (code) => {
      if (!port) rej(new Error(`server exit before ready (${code}): ${stderrBuf}`));
    });
    setTimeout(() => {
      if (!port) rej(new Error(`server timeout: ${stderrBuf}`));
    }, 5000).unref();
  });
  return {
    base: `http://127.0.0.1:${port}`,
    plansDir,
    kill: () =>
      new Promise((r) => {
        child.once('exit', () => r());
        child.kill('SIGTERM');
        setTimeout(() => {
          try {
            child.kill('SIGKILL');
          } catch {}
        }, 1000).unref();
      }),
  };
};

const putPlan = (base, slug, planId) =>
  fetch(`${base}/api/test-plans/${slug}/${planId}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      goal: 'validate the participants flow',
      story_id: 'ROK-1346',
      steps: [{ description: 'open the page; expect content' }],
    }),
  });

const PLAN = '2026-06-03-1915-aaaa';

test('prunes a stale slug only after a NEW env registers (not on bare removal)', async () => {
  const stateDir = await mkdtemp(join(tmpdir(), 'rl-dash-prune-'));
  await writeRegistry(stateDir, ['active', 'stale']);
  const srv = await startServer(stateDir);
  try {
    // Seed plans for both live slugs (PUT guard requires a live env).
    assert.equal((await putPlan(srv.base, 'active', PLAN)).status, 201);
    assert.equal((await putPlan(srv.base, 'stale', PLAN)).status, 201);

    // Poll 1 — first observation establishes the baseline {active, stale};
    // never prunes on the first poll.
    assert.equal((await fetch(`${srv.base}/api/state`)).status, 200);
    assert.ok(await exists(join(srv.plansDir, 'stale')), 'baseline poll must not prune');

    // Env-destroy of `stale`: registry shrinks, NO addition. Must NOT prune —
    // progress survives a future same-slug redeploy.
    await writeRegistry(stateDir, ['active']);
    assert.equal((await fetch(`${srv.base}/api/state`)).status, 200);
    assert.ok(
      await exists(join(srv.plansDir, 'stale')),
      'bare removal must NOT prune (destroy preserves plans)',
    );

    // A fresh story claims a slot: registry GAINS `fresh`. This addition
    // triggers the prune; `stale` (no live env) is cleared, the rest kept.
    await writeRegistry(stateDir, ['active', 'fresh']);
    assert.equal((await putPlan(srv.base, 'fresh', PLAN)).status, 201);
    assert.equal((await fetch(`${srv.base}/api/state`)).status, 200);

    assert.equal(
      await exists(join(srv.plansDir, 'stale')),
      false,
      'addition of a new env must prune the orphaned `stale` slug',
    );
    assert.ok(await exists(join(srv.plansDir, 'active')), 'live `active` kept');
    assert.ok(await exists(join(srv.plansDir, 'fresh')), 'just-added `fresh` kept');
  } finally {
    await srv.kill();
    await rm(stateDir, { recursive: true, force: true });
  }
});
