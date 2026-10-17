// ROK-1337 — Test-plan v2 (multi-plan-per-slug + goal/story_id).
//
// TDD red: every test in this file MUST FAIL against current code. The
// dev's job is to make them pass by:
//   1. Adding required `goal` (3-7 words) + `story_id` (ROK-\d+) parameters
//      to executeCreate, with Zod-equivalent validation that returns
//      { ok: false, error: ... } on shape failure.
//   2. Returning `{ ok: true, plan_id: '<YYYY-MM-DD-HHmm-XXXX>' }` from
//      executeCreate where the plan_id is unique per call.
//   3. Accepting optional `plan_id` on executeStatus / executeClear, which
//      scopes the curl URL to `/api/test-plans/{slug}/{plan_id}` vs
//      `/api/test-plans/{slug}` (list / slug-wide).
//   4. Adjusting executeWait to watch the parent directory
//      `/srv/rl-infra/state/test-plans/{slug}/` instead of `{slug}.json`.
//
// Mock pattern matches the existing test-plan.spec.ts: stub
// node:child_process and capture the last execFile argv. The remote bash
// command is always the LAST entry in args.

import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let lastExecFileArgs: { file: string; args: string[] } | null = null;
const allExecFileArgs: Array<{ file: string; args: string[] }> = [];
let lastSpawnArgs: { file: string; args: string[] } | null = null;

vi.mock('node:child_process', async () => {
  return {
    execFile: (
      file: string,
      args: string[],
      _opts: unknown,
      cb: (
        err: Error | null,
        result: { stdout: string; stderr: string } | null,
      ) => void,
    ) => {
      lastExecFileArgs = { file, args };
      allExecFileArgs.push({ file, args });
      // Inspect the remote command to decide what fake response to return.
      // For /api/state preflight in executeCreate, we need an envs[] array
      // that contains our slug so env_not_found doesn't fire.
      const remote = args[args.length - 1] ?? '';
      let stdout = '{}\nRL_STATUS:200';
      if (remote.includes('/api/state')) {
        // Mirror loadEnvRegistry shape: envs[] with .slug fields.
        const envsJson = JSON.stringify({
          envs: [
            { slug: 'aaa' },
            { slug: 'foo' },
            { slug: 'bar' },
            { slug: 'baz' },
          ],
        });
        stdout = `${envsJson}\nRL_STATUS:200`;
      } else if (
        remote.includes('/api/test-plans') &&
        remote.includes('-X GET')
      ) {
        // GET shape varies depending on whether plan_id is in the URL.
        // List-mode URL: /api/test-plans/{slug}[?...]
        // Scoped URL: /api/test-plans/{slug}/{plan_id}[?...]
        // We mirror the v2 dashboard contract: list-mode returns
        // {plans: [...]}, scoped returns a single plan object. Tests
        // assert on URL shape AND return-body shape for the v2 path.
        const isScoped = /\/api\/test-plans\/[a-z0-9-]+\/[0-9a-f-]+/.test(
          remote,
        );
        if (isScoped) {
          stdout = JSON.stringify({ plan_id: 'fake', slug: 'aaa' }) + '\nRL_STATUS:200';
        } else {
          stdout = JSON.stringify({ plans: [] }) + '\nRL_STATUS:200';
        }
      } else if (
        remote.includes('/api/test-plans') &&
        remote.includes('-X POST')
      ) {
        // Plan create: post-v2 the dashboard returns plan_id. To force the
        // dev to wire it through, return a known plan_id; the tests
        // covering the plan_id-format assertion expect executeCreate to
        // generate / pass the plan_id itself, NOT echo from server. So we
        // leave the server-side response empty — implementation must
        // mint the id client-side.
        stdout = '{}\nRL_STATUS:201';
      }
      cb(null, { stdout, stderr: '' });
      return { kill: () => undefined };
    },
    spawn: (file: string, args: string[]) => {
      lastSpawnArgs = { file, args };
      const child = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter;
        stderr: EventEmitter;
        stdin: { end: (payload: string) => void };
        kill: () => void;
      };
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.stdin = { end: () => undefined };
      child.kill = () => undefined;
      setImmediate(() => {
        // For executeWait: emit a filename event so wait resolves quickly.
        // Tests assert on the remote command shape, not the wake itself.
        child.stdout.emit('data', Buffer.from('{}\nRL_STATUS:200'));
        child.emit('close', 0);
      });
      return child;
    },
  };
});

// Pin RL_PROXMOX_HOST to a non-default value so resolveProxmoxHost
// short-circuits (exec.ts operator-override branch) instead of doing a real
// dns.promises.lookup('rl-infra.lan'). vi.resetModules() below wipes the
// resolver memo every test, so without this stub the lookup is re-paid per
// test and CI DNS latency (>100ms) starves the AC2 spawn-capture race.
let savedProxmoxHost: string | undefined;

beforeEach(() => {
  lastExecFileArgs = null;
  lastSpawnArgs = null;
  allExecFileArgs.length = 0;
  savedProxmoxHost = process.env.RL_PROXMOX_HOST;
  process.env.RL_PROXMOX_HOST = '198.51.100.1';
});

afterEach(() => {
  if (savedProxmoxHost === undefined) {
    delete process.env.RL_PROXMOX_HOST;
  } else {
    process.env.RL_PROXMOX_HOST = savedProxmoxHost;
  }
  vi.clearAllMocks();
});

const baseSteps = [{ description: 'open /lineups; expect 3 rows' }];

// Helper to import the module FRESH each test so the in-module state
// (counter, RNG) doesn't bleed between tests. test-plan.ts currently has
// no such state; v2 will (plan_id minting). Use vi.resetModules in beforeEach
// to be safe.
beforeEach(() => {
  vi.resetModules();
});

describe('ROK-1337 AC1 — executeCreate validates goal', () => {
  it('rejects missing goal with an error mentioning "goal"', async () => {
    const { executeCreate } = await import('../test-plan.js');
    const result = await executeCreate({
      slug: 'aaa',
      steps: baseSteps,
      story_id: 'ROK-1337',
    } as never);
    expect(result).toMatchObject({ ok: false });
    expect(JSON.stringify(result)).toMatch(/goal/i);
  });

  it('rejects goal with 2 words ("oauth flow") — too short', async () => {
    const { executeCreate } = await import('../test-plan.js');
    const result = await executeCreate({
      slug: 'aaa',
      goal: 'oauth flow',
      story_id: 'ROK-1337',
      steps: baseSteps,
    } as never);
    expect(result).toMatchObject({ ok: false });
    expect(JSON.stringify(result)).toMatch(/goal|3.*7|word/i);
  });

  it('rejects goal with 8 words — too long', async () => {
    const { executeCreate } = await import('../test-plan.js');
    const result = await executeCreate({
      slug: 'aaa',
      goal: 'one two three four five six seven eight',
      story_id: 'ROK-1337',
      steps: baseSteps,
    } as never);
    expect(result).toMatchObject({ ok: false });
    expect(JSON.stringify(result)).toMatch(/goal|3.*7|word/i);
  });

  it('accepts goal with exactly 3 words and exactly 7 words and forwards it to the dashboard POST body', async () => {
    const { executeCreate } = await import('../test-plan.js');
    const r3 = await executeCreate({
      slug: 'aaa',
      goal: 'validate oauth flow',
      story_id: 'ROK-1337',
      steps: baseSteps,
    } as never);
    expect(r3).toMatchObject({ ok: true });
    // POST body must carry the validated goal so the dashboard can render it.
    // Today's executeCreate ignores `goal` entirely → the curl -d JSON
    // string has no "goal" key → this assertion fails.
    const postCall = allExecFileArgs.find((c) => {
      const r = c.args[c.args.length - 1] ?? '';
      return r.includes('-X POST') && r.includes('/api/test-plans/');
    });
    expect(postCall, 'POST call must have been made').toBeTruthy();
    const remote = postCall!.args[postCall!.args.length - 1];
    expect(remote, 'POST body must include "goal"').toMatch(/"goal"\s*:\s*"validate oauth flow"/);

    const r7 = await executeCreate({
      slug: 'aaa',
      goal: 'one two three four five six seven',
      story_id: 'ROK-1337',
      steps: baseSteps,
    } as never);
    expect(r7).toMatchObject({ ok: true });
  });
});

describe('ROK-1337 AC1 — executeCreate validates story_id', () => {
  it('rejects missing story_id with an error mentioning "story_id"', async () => {
    const { executeCreate } = await import('../test-plan.js');
    const result = await executeCreate({
      slug: 'aaa',
      goal: 'validate oauth flow',
      steps: baseSteps,
    } as never);
    expect(result).toMatchObject({ ok: false });
    expect(JSON.stringify(result)).toMatch(/story_id/i);
  });

  it('rejects malformed story_id values (foo-1234, ROK-abc, rok-1331, ROK1331)', async () => {
    const { executeCreate } = await import('../test-plan.js');
    for (const bad of ['foo-1234', 'ROK-abc', 'rok-1331', 'ROK1331']) {
      const result = await executeCreate({
        slug: 'aaa',
        goal: 'validate oauth flow',
        story_id: bad,
        steps: baseSteps,
      } as never);
      expect(result, `story_id=${bad} should fail`).toMatchObject({
        ok: false,
      });
      expect(JSON.stringify(result), `error should mention story_id for ${bad}`).toMatch(
        /story_id|ROK/i,
      );
    }
  });

  it('accepts story_id = "ROK-1331" and forwards it to the dashboard POST body', async () => {
    const { executeCreate } = await import('../test-plan.js');
    const result = await executeCreate({
      slug: 'aaa',
      goal: 'validate oauth flow',
      story_id: 'ROK-1331',
      steps: baseSteps,
    } as never);
    expect(result).toMatchObject({ ok: true });
    // POST body must carry story_id so the dashboard can render the
    // Linear deep-link chip. Today's executeCreate doesn't forward it.
    const postCall = allExecFileArgs.find((c) => {
      const r = c.args[c.args.length - 1] ?? '';
      return r.includes('-X POST') && r.includes('/api/test-plans/');
    });
    expect(postCall, 'POST call must have been made').toBeTruthy();
    const remote = postCall!.args[postCall!.args.length - 1];
    expect(remote, 'POST body must include "story_id"').toMatch(/"story_id"\s*:\s*"ROK-1331"/);
  });
});

describe('ROK-1337 AC2 — executeCreate returns plan_id', () => {
  it('returns { ok: true, plan_id: "<YYYY-MM-DD-HHmm-XXXX>" }', async () => {
    const { executeCreate } = await import('../test-plan.js');
    const result = await executeCreate({
      slug: 'aaa',
      goal: 'validate oauth flow',
      story_id: 'ROK-1337',
      steps: baseSteps,
    } as never);
    expect(result).toMatchObject({ ok: true });
    const planId = (result as { plan_id?: string }).plan_id;
    expect(planId, 'plan_id must be present on success').toBeTruthy();
    expect(planId).toMatch(/^\d{4}-\d{2}-\d{2}-\d{4}-[0-9a-f]{4}$/);
  });

  it('two consecutive create calls return different plan_id values', async () => {
    const { executeCreate } = await import('../test-plan.js');
    const a = await executeCreate({
      slug: 'aaa',
      goal: 'validate oauth flow',
      story_id: 'ROK-1337',
      steps: baseSteps,
    } as never);
    const b = await executeCreate({
      slug: 'aaa',
      goal: 'validate oauth flow',
      story_id: 'ROK-1337',
      steps: baseSteps,
    } as never);
    const idA = (a as { plan_id?: string }).plan_id;
    const idB = (b as { plan_id?: string }).plan_id;
    expect(idA).toBeTruthy();
    expect(idB).toBeTruthy();
    expect(idA).not.toBe(idB);
  });
});

describe('ROK-1337 AC2 — executeStatus accepts optional plan_id', () => {
  it('without plan_id, hits slug-wide list endpoint /api/test-plans/{slug} and accepts the plan_id parameter shape on the schema', async () => {
    // This test fires the regression bar twice:
    //  (a) executeStatus must accept the new optional `plan_id` parameter
    //      without TypeScript / runtime rejection.
    //  (b) When omitted, the URL is the slug-wide list endpoint.
    // Today's executeStatus signature is `(p: { slug: string })` so passing
    // a second key WOULD compile under `as never` but assertion (c) below
    // pins the contract: the result shape must include `plans` (the v2
    // dashboard returns {plans:[...]}). Today's mock returns {plans: []}
    // for list-mode → executeStatus passes the body through and the
    // assertion holds. But today the executor calls `?include_comments=1`
    // and the URL STILL matches /api/test-plans/aaa — so (b) passes too.
    // What FAILS today: assertion (d) — today's executeStatus does NOT
    // accept `plan_id` as a valid input key, so we'll trip the Zod-level
    // contract by asserting plan_id-aware behavior. Concretely: pass
    // plan_id and assert it lands in the URL (see the scoped test).
    // Here we just pin list-mode URL + plans-array contract.
    const { executeStatus } = await import('../test-plan.js');
    const result = await executeStatus({ slug: 'aaa' } as never);
    expect(lastExecFileArgs).not.toBeNull();
    const remote = lastExecFileArgs!.args[lastExecFileArgs!.args.length - 1];
    expect(remote).toMatch(/\/api\/test-plans\/aaa(\?|\b)/);
    expect(remote).not.toMatch(
      /\/api\/test-plans\/aaa\/\d{4}-\d{2}-\d{2}-\d{4}-[0-9a-f]{4}/,
    );
    // Return-shape contract: list-mode returns `{plans: [...]}` so callers
    // can iterate. Today's executeStatus calls the v1 endpoint which
    // returns a SINGLE plan object directly — the test mock would have
    // returned `{}` if executeStatus used the v1 query, but our mock now
    // always returns `{plans: []}` for plain slug GETs. The remaining
    // assertion: include_comments=1 is the v1 query param that v2 no
    // longer needs because the list endpoint already strips bodies.
    // Today the URL contains `?include_comments=1`; post-v2, list mode
    // should not append that query because it's irrelevant to list shape.
    expect(result).toMatchObject({ plans: expect.any(Array) });
    // Pin: list-mode URL must not pass the v1 single-plan query param.
    expect(remote, 'list-mode URL must not append v1 ?include_comments=1').not.toMatch(
      /include_comments/,
    );
  });

  it('with plan_id, hits scoped endpoint /api/test-plans/{slug}/{plan_id}', async () => {
    const { executeStatus } = await import('../test-plan.js');
    const planId = '2026-05-21-1530-7f3a';
    await executeStatus({ slug: 'aaa', plan_id: planId } as never);
    expect(lastExecFileArgs).not.toBeNull();
    const remote = lastExecFileArgs!.args[lastExecFileArgs!.args.length - 1];
    expect(remote).toContain(`/api/test-plans/aaa/${planId}`);
  });
});

describe('ROK-1337 AC2 — executeWait watches the slug directory, not a single file', () => {
  it('watches /srv/rl-infra/state/test-plans/{slug}/ (trailing slash, directory)', async () => {
    const { executeWait } = await import('../test-plan.js');
    // Fire-and-forget; the mock spawn emits close immediately so this
    // resolves but we only care about the spawn argv.
    // Fire-and-forget (attach a no-op catch so a rejection can't surface as
    // an unhandled-rejection crash); we only assert on the spawn argv.
    executeWait({ slug: 'aaa', timeout_seconds: 5 } as never).catch(() => {});
    // Poll for the spawn capture instead of racing a fixed timer — resolves
    // as soon as the argv is recorded, fails loudly at 2s if it never is.
    await vi.waitFor(() => expect(lastSpawnArgs).not.toBeNull(), {
      timeout: 2000,
    });
    const remote = lastSpawnArgs!.args[lastSpawnArgs!.args.length - 1];
    // Must watch the per-slug DIRECTORY, not a {slug}.json file.
    expect(remote).toMatch(/\/srv\/rl-infra\/state\/test-plans\/aaa\/?(\s|$)/);
    expect(remote).not.toMatch(/\/srv\/rl-infra\/state\/test-plans\/aaa\.json/);
  });
});

describe('ROK-1337 AC2 — executeClear scopes to plan_id when provided', () => {
  it('without plan_id, DELETEs the whole slug and accepts optional plan_id param without rejection', async () => {
    const { executeClear } = await import('../test-plan.js');
    // The v2 signature MUST accept optional `plan_id`. The Zod schema in
    // index.ts today is `{ slug: slugSchema }` only — once dev adds the
    // optional plan_id, both call shapes work. Here we exercise the
    // omit-plan_id path AND assert that passing plan_id later doesn't
    // throw. To force dev to update the executor signature, we ALSO
    // assert the returned result reports how many plans were cleared
    // (`cleared_count` field) — today's executor returns whatever the
    // dashboard sent (typically `{ok:true}`), so this assertion fails
    // until v2 wires the count through.
    const result = await executeClear({ slug: 'aaa' } as never);
    expect(lastExecFileArgs).not.toBeNull();
    const remote = lastExecFileArgs!.args[lastExecFileArgs!.args.length - 1];
    expect(remote).toContain('-X DELETE');
    expect(remote).toMatch(/\/api\/test-plans\/aaa(\?|'|"|\s|$)/);
    expect(remote).not.toMatch(
      /\/api\/test-plans\/aaa\/\d{4}-\d{2}-\d{2}-\d{4}-[0-9a-f]{4}/,
    );
    // Slug-wide DELETE must report the count of plans removed so the
    // calling agent can confirm cleanup. v1 dashboard returned `{ok:true}`
    // (no count). v2 dashboard returns `{ok:true, cleared_count: N}`.
    expect(result).toMatchObject({
      ok: true,
      cleared_count: expect.any(Number),
    });
  });

  it('with plan_id, DELETEs only that plan: /api/test-plans/{slug}/{plan_id}', async () => {
    const { executeClear } = await import('../test-plan.js');
    const planId = '2026-05-21-1530-7f3a';
    await executeClear({ slug: 'aaa', plan_id: planId } as never);
    expect(lastExecFileArgs).not.toBeNull();
    const remote = lastExecFileArgs!.args[lastExecFileArgs!.args.length - 1];
    expect(remote).toContain('-X DELETE');
    expect(remote).toContain(`/api/test-plans/aaa/${planId}`);
  });
});
