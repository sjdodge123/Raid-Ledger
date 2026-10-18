// ROK-1847 — shared harness for the test-plan auth specs. Not a *.test.js
// file, so `node --test rl-infra/dashboard/test/*.test.js` does not run it.
import { spawn } from 'node:child_process';
import { request } from 'node:http';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_PATH = resolve(__dirname, '..', 'server.js');
const PUBLIC_DIR = resolve(__dirname, '..', 'public');

export const AGENT_TOKEN = 'agent-secret-for-rok-1847-tests';
export const PLAN_A = '2026-10-18-1200-aaaa';
export const PLAN_B = '2026-10-18-1200-bbbb';

export const makeStateDir = async () => {
  const dir = await mkdtemp(join(tmpdir(), 'rl-dash-1847-'));
  await writeFile(join(dir, 'claims.json'), JSON.stringify([{ slot: 1, claimed: false }]));
  await writeFile(join(dir, 'env-registry.json'), JSON.stringify([{ slug: 'foo', slot: 1 }]));
  await mkdir(join(dir, 'test-plans', 'foo'), { recursive: true });
  return dir;
};

// `agentToken: null` boots the server with RL_AGENT_TOKEN unset.
export const startServer = async (stateDir, { agentToken = AGENT_TOKEN } = {}) => {
  const env = { ...process.env, PORT: '0', STATE_DIR: stateDir, PUBLIC_DIR,
    RL_PUBLIC_DOMAIN: 'gamernight.net', NODE_ENV: 'test' };
  delete env.RL_AGENT_TOKEN;
  if (agentToken !== null) env.RL_AGENT_TOKEN = agentToken;
  const child = spawn(process.execPath, [SERVER_PATH], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  let err = '';
  child.stderr.on('data', (c) => { err += c.toString('utf-8'); });
  const port = await new Promise((res, rej) => {
    child.stdout.on('data', (c) => {
      out += c.toString('utf-8');
      const m = out.match(/listening on :(\d+)/);
      if (m) res(parseInt(m[1], 10));
    });
    child.once('exit', (code) => rej(new Error(`server exited (${code}): ${err}`)));
    setTimeout(() => rej(new Error(`server timeout: ${err}`)), 5000).unref();
  });
  return {
    port,
    kill: () => new Promise((r) => { child.once('exit', () => r()); child.kill('SIGTERM'); }),
  };
};

// node:http rather than fetch so the spec can set an explicit Host header.
export const call = (port, method, path, { body, headers = {} } = {}) =>
  new Promise((res, rej) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const h = { host: '127.0.0.1', ...headers };
    if (payload !== undefined) {
      h['content-type'] = 'application/json';
      h['content-length'] = Buffer.byteLength(payload);
    }
    const req = request({ host: '127.0.0.1', port, method, path, headers: h }, (r) => {
      let text = '';
      r.on('data', (c) => { text += c; });
      r.on('end', () => {
        let json = null;
        try { json = JSON.parse(text); } catch { /* non-JSON */ }
        res({ status: r.statusCode, text, json });
      });
    });
    req.on('error', rej);
    if (payload !== undefined) req.write(payload);
    req.end();
  });

export const agentHeaders = { 'x-agent-token': AGENT_TOKEN };

export const planBody = (overrides = {}) => ({
  goal: 'verify the auth gate works',
  story_id: 'ROK-1847',
  steps: [
    { description: 'step one', test_url: 'https://slot-1.gamernight.net/events/1' },
    { description: 'step two' },
  ],
  ...overrides,
});

// Writes a plan file directly (bypasses the PUT gate) with one comment body.
export const seedPlanFile = async (stateDir, planId, extra = {}) => {
  const plan = {
    slug: 'foo', plan_id: planId, goal: 'seeded plan for auth tests', story_id: 'ROK-1847',
    title: null, created_at: '2026-10-18T12:00:00.000Z', created_by: null,
    steps: [{ id: 1, description: 'seeded', expected: null, category: null, test_url: null,
      reset_hint: null, results: [], reset_requests: [],
      comments: [{ tester: 'op', ts: '2026-10-18T12:01:00.000Z', body: 'SECRET-COMMENT-BODY' }] }],
    ...extra,
  };
  await writeFile(join(stateDir, 'test-plans', 'foo', `${planId}.json`), JSON.stringify(plan));
  return plan;
};
