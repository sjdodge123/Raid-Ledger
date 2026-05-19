// rl-dashboard — tiny mobile-friendly fleet status page.
//
// Reads /state/claims.json + /state/env-registry.json (both bind-mounted from
// the host's /srv/rl-infra/state/ as read-only) and serves a single HTML page
// + a /api/state JSON endpoint that the page polls every 5s.
//
// Routed via Traefik at fleet.rl.lan (wildcard *.rl.lan -> 192.168.0.132
// already resolves; no extra Pi-hole entry needed).
//
// Intentionally zero deps. Pure Node http module.

import { createServer } from 'node:http';
import { createConnection } from 'node:net';
import { readFile, writeFile, mkdir, unlink, readdir } from 'node:fs/promises';
import { join, extname } from 'node:path';

const STATE_DIR = process.env.STATE_DIR || '/state';
const PUBLIC_DIR = process.env.PUBLIC_DIR || '/app/public';
const TEST_PLANS_DIR = process.env.TEST_PLANS_DIR || join(STATE_DIR, 'test-plans');
const PORT = parseInt(process.env.PORT || '8080', 10);
// When set, the dashboard renders BOTH http://{slug}.rl.lan (internal) AND
// http://{slug}.${PUBLIC_DOMAIN} (external, for testers behind your proxy)
// as links per env. env-spin already writes Traefik routes for both.
const PUBLIC_DOMAIN = process.env.RL_PUBLIC_DOMAIN || '';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const sendJson = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

// TCP probe with short timeout. Used to detect whether the runner is
// actively serving a dev server on its conventional ports — slots are just
// shell containers until an agent runs `npm run dev -w web` or starts a
// Node process with --inspect. Without this probe, the dashboard's web/
// debug buttons would always render but 502 on click whenever nothing is
// listening, which is most of the time.
const probePort = (host, port, timeoutMs = 400) =>
  new Promise((resolve) => {
    let done = false;
    const socket = createConnection({ host, port });
    const finish = (ok) => {
      if (done) return;
      done = true;
      try { socket.destroy(); } catch {}
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.once('timeout', () => finish(false));
  });

const enrichSlotsWithProbes = async (slots) =>
  Promise.all(
    slots.map(async (slot) => {
      // Slot containers are reachable by name on the rl-net Docker network.
      // Conventional dev ports: 5173 (Vite), 9229 (Node inspector).
      const host = `rl-runner-${slot.slot}`;
      const [webUp, debugUp] = await Promise.all([
        probePort(host, 5173),
        probePort(host, 9229),
      ]);
      return { ...slot, web_listening: webUp, debug_listening: debugUp };
    }),
  );

// Read all current test-plan summaries (sluggable, cheap — usually 0-5 files).
// Returned inline in /api/state so the dashboard renders without an N+1
// fetch per env card.
const collectPlanSummaries = async () => {
  try {
    const files = await readdir(TEST_PLANS_DIR);
    const out = {};
    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      const slug = f.slice(0, -5);
      try {
        const plan = JSON.parse(await readFile(join(TEST_PLANS_DIR, f), 'utf-8'));
        out[slug] = summarizePlan(plan);
      } catch { /* skip bad files */ }
    }
    return out;
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    throw err;
  }
};

const handleApiState = async (res) => {
  try {
    const [claims, envs] = await Promise.all([
      readFile(join(STATE_DIR, 'claims.json'), 'utf-8'),
      readFile(join(STATE_DIR, 'env-registry.json'), 'utf-8'),
    ]);
    const slots = JSON.parse(claims);
    const [probedSlots, planSummaries] = await Promise.all([
      enrichSlotsWithProbes(slots),
      collectPlanSummaries(),
    ]);
    // Attach per-env plan summaries to each env entry so the client
    // doesn't need a separate fetch per card.
    const enrichedEnvs = JSON.parse(envs).map((envEntry) =>
      planSummaries[envEntry.slug]
        ? { ...envEntry, _test_plan_summary: planSummaries[envEntry.slug] }
        : envEntry,
    );
    sendJson(res, 200, {
      ok: true,
      slots: probedSlots,
      envs: enrichedEnvs,
      public_domain: PUBLIC_DOMAIN || null,
      generated_at: new Date().toISOString(),
    });
  } catch (err) {
    sendJson(res, 500, { ok: false, error: err.message });
  }
};

const sanitizePath = (urlPath) => {
  // Disallow directory traversal. Only allow files under PUBLIC_DIR.
  const cleaned = urlPath.split('?')[0].split('#')[0];
  if (cleaned.includes('..')) return null;
  return cleaned === '/' ? '/index.html' : cleaned;
};

// ----- Test plans -----
// Stored at TEST_PLANS_DIR/<slug>.json. Slug already validated by the MCP
// tool ([a-z0-9-]+); we re-validate here as defense-in-depth before any
// filesystem ops.
const SLUG_RE = /^[a-z0-9-]+$/;
const VERDICTS = new Set(['pass', 'fail', 'skip']);

const validSlug = (s) => typeof s === 'string' && s.length > 0 && s.length <= 63 && SLUG_RE.test(s);

const planPath = (slug) => join(TEST_PLANS_DIR, `${slug}.json`);

// Read JSON body with a size cap so a misbehaving client can't OOM us.
const readJsonBody = (req, max = 64 * 1024) =>
  new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > max) {
        req.destroy();
        reject(new Error('body too large'));
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8') || '{}')); }
      catch (err) { reject(err); }
    });
    req.on('error', reject);
  });

// Atomic write: temp file in same dir + rename. Avoids partial reads
// during the dashboard's 5s polling tick.
const writePlanAtomic = async (slug, plan) => {
  await mkdir(TEST_PLANS_DIR, { recursive: true });
  const tmp = join(TEST_PLANS_DIR, `.${slug}.${Date.now()}.tmp`);
  await writeFile(tmp, JSON.stringify(plan, null, 2));
  const { rename } = await import('node:fs/promises');
  await rename(tmp, planPath(slug));
};

const summarizePlan = (plan) => {
  const total = plan.steps.length;
  // A step's effective verdict is the LATEST result (any tester). Pending
  // = no results yet. The first-tester-wins ordering matches what the UI
  // shows: most-recent verdict drives the badge color.
  const counts = { pass: 0, fail: 0, skip: 0, pending: 0 };
  let lastUpdated = plan.created_at;
  for (const step of plan.steps) {
    const last = (step.results ?? []).slice(-1)[0];
    if (!last) counts.pending++;
    else {
      counts[last.verdict] = (counts[last.verdict] ?? 0) + 1;
      if (last.ts > lastUpdated) lastUpdated = last.ts;
    }
  }
  return { total, ...counts, last_updated_at: lastUpdated };
};

const handleTestPlanGet = async (slug, res) => {
  if (!validSlug(slug)) return sendJson(res, 400, { ok: false, error: 'invalid slug' });
  try {
    const plan = JSON.parse(await readFile(planPath(slug), 'utf-8'));
    sendJson(res, 200, { ok: true, plan, summary: summarizePlan(plan) });
  } catch (err) {
    if (err.code === 'ENOENT') return sendJson(res, 404, { ok: false, error: 'no plan for slug' });
    sendJson(res, 500, { ok: false, error: err.message });
  }
};

const handleTestPlanPut = async (slug, req, res) => {
  if (!validSlug(slug)) return sendJson(res, 400, { ok: false, error: 'invalid slug' });
  let body;
  try { body = await readJsonBody(req); }
  catch (err) { return sendJson(res, 400, { ok: false, error: err.message }); }

  if (!Array.isArray(body.steps) || body.steps.length === 0)
    return sendJson(res, 400, { ok: false, error: 'steps[] required' });
  if (body.steps.length > 100)
    return sendJson(res, 400, { ok: false, error: 'max 100 steps per plan' });

  // Preserve existing results on replace=true unless explicitly cleared.
  let existing = null;
  if (!body.replace) {
    try { existing = JSON.parse(await readFile(planPath(slug), 'utf-8')); }
    catch (err) { if (err.code !== 'ENOENT') throw err; }
    if (existing)
      return sendJson(res, 409, { ok: false, error: 'plan exists; pass replace=true to overwrite' });
  }

  const plan = {
    slug,
    title: typeof body.title === 'string' ? body.title.slice(0, 200) : null,
    created_at: new Date().toISOString(),
    created_by: typeof body.created_by === 'string' ? body.created_by.slice(0, 200) : null,
    steps: body.steps.map((s, idx) => ({
      id: idx + 1,
      description: String(s.description ?? '').slice(0, 500),
      expected: s.expected ? String(s.expected).slice(0, 500) : null,
      category: s.category ? String(s.category).slice(0, 50) : null,
      results: [],
    })),
  };
  await writePlanAtomic(slug, plan);
  sendJson(res, 201, { ok: true, plan, summary: summarizePlan(plan) });
};

const handleTestPlanStepResult = async (slug, stepIdRaw, req, res) => {
  if (!validSlug(slug)) return sendJson(res, 400, { ok: false, error: 'invalid slug' });
  const stepId = parseInt(stepIdRaw, 10);
  if (!Number.isInteger(stepId) || stepId < 1)
    return sendJson(res, 400, { ok: false, error: 'invalid step id' });

  let body;
  try { body = await readJsonBody(req); }
  catch (err) { return sendJson(res, 400, { ok: false, error: err.message }); }

  if (!VERDICTS.has(body.verdict))
    return sendJson(res, 400, { ok: false, error: 'verdict must be pass|fail|skip' });
  const tester = typeof body.tester === 'string'
    ? body.tester.replace(/[^A-Za-z0-9 _.-]/g, '').slice(0, 50)
    : 'anon';

  let plan;
  try { plan = JSON.parse(await readFile(planPath(slug), 'utf-8')); }
  catch (err) {
    if (err.code === 'ENOENT') return sendJson(res, 404, { ok: false, error: 'no plan for slug' });
    return sendJson(res, 500, { ok: false, error: err.message });
  }

  const step = plan.steps.find((s) => s.id === stepId);
  if (!step) return sendJson(res, 404, { ok: false, error: 'step not found' });

  // Sequential ordering: reject if any earlier step has no verdict yet.
  // A step is "decided" if it has at least one result entry (most-recent
  // wins). This means a tester must work through the list in order.
  for (let i = 0; i < plan.steps.length; i++) {
    const s = plan.steps[i];
    if (s.id >= stepId) break;
    if (!s.results || s.results.length === 0)
      return sendJson(res, 409, {
        ok: false, error: 'must complete prior steps first', blocked_by: s.id,
      });
  }

  step.results = step.results ?? [];
  step.results.push({
    tester,
    verdict: body.verdict,
    ts: new Date().toISOString(),
  });
  // Cap history at 20 entries per step — keep most recent.
  if (step.results.length > 20) step.results = step.results.slice(-20);

  await writePlanAtomic(slug, plan);
  sendJson(res, 200, { ok: true, plan, summary: summarizePlan(plan) });
};

const handleTestPlanDelete = async (slug, res) => {
  if (!validSlug(slug)) return sendJson(res, 400, { ok: false, error: 'invalid slug' });
  try {
    await unlink(planPath(slug));
    sendJson(res, 200, { ok: true });
  } catch (err) {
    if (err.code === 'ENOENT') return sendJson(res, 200, { ok: true, noop: true });
    sendJson(res, 500, { ok: false, error: err.message });
  }
};

// Lightweight list endpoint — returns a map of slug -> summary so the
// dashboard can show "this env has a test plan" badges without N requests.
const handleTestPlanList = async (res) => {
  try {
    const files = await readdir(TEST_PLANS_DIR);
    const summaries = {};
    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      const slug = f.slice(0, -5);
      try {
        const plan = JSON.parse(await readFile(join(TEST_PLANS_DIR, f), 'utf-8'));
        summaries[slug] = summarizePlan(plan);
      } catch { /* skip bad file */ }
    }
    sendJson(res, 200, { ok: true, summaries });
  } catch (err) {
    if (err.code === 'ENOENT') return sendJson(res, 200, { ok: true, summaries: {} });
    sendJson(res, 500, { ok: false, error: err.message });
  }
};

const serveStatic = async (req, res) => {
  const path = sanitizePath(req.url);
  if (!path) {
    res.writeHead(400);
    res.end('Bad path');
    return;
  }
  try {
    const data = await readFile(join(PUBLIC_DIR, path));
    const ct = MIME[extname(path)] || 'application/octet-stream';
    res.writeHead(200, {
      'content-type': ct,
      'cache-control': 'no-store',
    });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('Not Found');
  }
};

// Test-plan route patterns. Keep these as simple anchored regexes so the
// hot path stays predictable; no Express, no router framework.
const RE_PLAN = /^\/api\/test-plans\/([a-z0-9-]+)$/;
const RE_STEP = /^\/api\/test-plans\/([a-z0-9-]+)\/step\/(\d+)\/result$/;

const server = createServer(async (req, res) => {
  // Liveness probe for compose healthchecks / orchestrator pings.
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"ok":true}');
    return;
  }
  if (req.url === '/api/state') {
    await handleApiState(res);
    return;
  }
  if (req.url === '/api/test-plans' && req.method === 'GET') {
    await handleTestPlanList(res);
    return;
  }
  const planMatch = req.url && RE_PLAN.exec(req.url);
  if (planMatch) {
    const slug = planMatch[1];
    if (req.method === 'GET') return handleTestPlanGet(slug, res);
    if (req.method === 'PUT' || req.method === 'POST') return handleTestPlanPut(slug, req, res);
    if (req.method === 'DELETE') return handleTestPlanDelete(slug, res);
    res.writeHead(405); res.end('Method Not Allowed'); return;
  }
  const stepMatch = req.url && RE_STEP.exec(req.url);
  if (stepMatch) {
    if (req.method !== 'POST') { res.writeHead(405); res.end('Method Not Allowed'); return; }
    return handleTestPlanStepResult(stepMatch[1], stepMatch[2], req, res);
  }
  await serveStatic(req, res);
});

server.listen(PORT, '0.0.0.0', () => {
  // eslint-disable-next-line no-console
  console.log(`rl-dashboard listening on :${PORT}, state=${STATE_DIR}, public=${PUBLIC_DIR}`);
});
