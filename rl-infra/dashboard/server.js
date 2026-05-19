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
const ATTACHMENTS_DIR = process.env.ATTACHMENTS_DIR || join(STATE_DIR, 'test-plan-attachments');
const PORT = parseInt(process.env.PORT || '8080', 10);
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024; // 5 MB; phone screenshots are typically <2 MB.
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
  const counts = { pass: 0, fail: 0, skip: 0, pending: 0 };
  let lastUpdated = plan.created_at;
  let pendingResets = 0;
  let commentCount = 0;
  for (const step of plan.steps) {
    const last = (step.results ?? []).slice(-1)[0];
    if (!last) counts.pending++;
    else {
      counts[last.verdict] = (counts[last.verdict] ?? 0) + 1;
      if (last.ts > lastUpdated) lastUpdated = last.ts;
    }
    for (const r of step.reset_requests ?? []) {
      if (r.status === 'pending') {
        pendingResets++;
        if (r.ts > lastUpdated) lastUpdated = r.ts;
      }
    }
    for (const c of step.comments ?? []) {
      commentCount++;
      if (c.ts > lastUpdated) lastUpdated = c.ts;
    }
  }
  return {
    total, ...counts,
    pending_resets: pendingResets,
    comment_count: commentCount,
    last_updated_at: lastUpdated,
  };
};

// Comment handling has two paths now (operator pref 2026-05-19):
//   - Default (dashboard path): strip bodies so testers don't see each
//     others' notes — comments stay a one-way fire-and-forget channel.
//   - Agent path (?include_comments=1): bodies WRAPPED in an explicit
//     <untrusted-tester-comment> tag so the agent knows the content is
//     tester-supplied free-form text. The tag doesn't make the body
//     LLM-injection-safe (text is text), but it gives the agent a
//     clear cue to treat the contents as data, not instructions.
const stripCommentBodies = (plan) => ({
  ...plan,
  steps: plan.steps.map((s) => ({
    ...s,
    comments: (s.comments ?? []).map((c) => ({
      tester: c.tester, ts: c.ts, has_body: !!c.body,
      // body is OMITTED on purpose
    })),
  })),
});

const wrapCommentBodies = (plan) => ({
  ...plan,
  steps: plan.steps.map((s) => ({
    ...s,
    comments: (s.comments ?? []).map((c) => ({
      tester: c.tester,
      ts: c.ts,
      // Wrap the body so the agent's context window has a clear "this is
      // untrusted user input" boundary. Agent must treat it as data only.
      body: c.body
        ? `<untrusted-tester-comment>${c.body}</untrusted-tester-comment>`
        : null,
      // Attachment URL is fine to surface raw — it's a URL the agent can
      // Read via its image tool if needed; not text the LLM interprets
      // as instructions.
      attachment_url: c.attachment_url ?? null,
    })),
  })),
});

// Decide which transform applies to a given response based on the
// request's query string. Used by both the GET status handler and the
// POST handlers that return the plan.
const planForResponse = (plan, req) => {
  const includeComments = req && req.url && req.url.includes('include_comments=1');
  return includeComments ? wrapCommentBodies(plan) : stripCommentBodies(plan);
};

const handleTestPlanGet = async (slug, req, res) => {
  if (!validSlug(slug)) return sendJson(res, 400, { ok: false, error: 'invalid slug' });
  try {
    const plan = JSON.parse(await readFile(planPath(slug), 'utf-8'));
    sendJson(res, 200, { ok: true, plan: planForResponse(plan, req), summary: summarizePlan(plan) });
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
      // Optional deep link the tester taps to jump straight to the test
      // scenario (e.g. https://<slug>test.gamernight.net/lineups#common-ground).
      // URLs are validated to start with http:// or https:// — we don't try
      // to enforce same-origin since envs use multiple hostnames.
      test_url: validateUrl(s.test_url),
      // Free-form hint shown to the tester as a tooltip on the reset button
      // (e.g. "Refresh data via /admin/seed-lineups"). Agent-authored at plan
      // creation time — NEVER from tester input. Safe to render.
      reset_hint: s.reset_hint ? String(s.reset_hint).slice(0, 300) : null,
      results: [],
      // Reset requests are signals from testers to the agent ("this step is
      // in a bad state, please reset"). Each request is just {tester, ts}
      // — no free-form text. Agent sees them via rl_test_plan_status and
      // decides what to do (the step.reset_hint guides them).
      reset_requests: [],
    })),
  };
  await writePlanAtomic(slug, plan);
  sendJson(res, 201, { ok: true, plan: stripCommentBodies(plan), summary: summarizePlan(plan) });
};

const validateUrl = (raw) => {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim().slice(0, 500);
  if (!/^https?:\/\//i.test(trimmed)) return null;
  return trimmed;
};

// POST /api/test-plans/<slug>/submit
// Batch verdict submission: tester completes the form locally then submits
// the whole set in one request. Server applies them in order, enforcing
// the sequential rule (each verdict's step_id must follow the previous).
// All-or-nothing: any failure rejects the batch. This is the primary
// pass/fail entrypoint for the buffered-local-state flow; the per-step
// /step/<id>/result endpoint is still there for compatibility but the
// dashboard UI no longer uses it for the normal verdict path.
const handleTestPlanSubmit = async (slug, req, res) => {
  if (!validSlug(slug)) return sendJson(res, 400, { ok: false, error: 'invalid slug' });
  let body;
  try { body = await readJsonBody(req); }
  catch (err) { return sendJson(res, 400, { ok: false, error: err.message }); }

  if (!Array.isArray(body.verdicts) || body.verdicts.length === 0)
    return sendJson(res, 400, { ok: false, error: 'verdicts[] required' });
  if (body.verdicts.length > 100)
    return sendJson(res, 400, { ok: false, error: 'max 100 verdicts per batch' });

  const tester = typeof body.tester === 'string'
    ? body.tester.replace(/[^A-Za-z0-9 _.-]/g, '').slice(0, 50)
    : 'anon';

  let plan;
  try { plan = JSON.parse(await readFile(planPath(slug), 'utf-8')); }
  catch (err) {
    if (err.code === 'ENOENT') return sendJson(res, 404, { ok: false, error: 'no plan for slug' });
    return sendJson(res, 500, { ok: false, error: err.message });
  }

  // Validate the batch BEFORE mutating anything. We sort the incoming
  // verdicts by step_id ascending and check each is a valid step + valid
  // verdict + respects sequential ordering against the CURRENT plan state.
  const incoming = body.verdicts
    .filter((v) => Number.isInteger(v.step_id) && v.step_id >= 1)
    .sort((a, b) => a.step_id - b.step_id);

  for (const v of incoming) {
    if (!VERDICTS.has(v.verdict))
      return sendJson(res, 400, { ok: false, error: `step ${v.step_id}: verdict must be pass|fail|skip` });
    if (!plan.steps.find((s) => s.id === v.step_id))
      return sendJson(res, 404, { ok: false, error: `step ${v.step_id} not found` });
  }
  // Sequential check: every step ID smaller than the smallest in the batch
  // must already have a verdict (some prior submitter). The batch itself
  // must also be contiguous starting from the lowest unblocked step.
  const incomingIds = new Set(incoming.map((v) => v.step_id));
  for (const step of plan.steps) {
    const hasExisting = (step.results ?? []).length > 0;
    const inBatch = incomingIds.has(step.id);
    if (!hasExisting && !inBatch) {
      // step has no verdict and isn't in this batch — any LATER step in
      // the batch would violate the sequential rule.
      const laterInBatch = incoming.find((v) => v.step_id > step.id);
      if (laterInBatch)
        return sendJson(res, 409, {
          ok: false, error: 'sequential ordering violated',
          blocked_by: step.id, attempted: laterInBatch.step_id,
        });
    }
  }

  const ts = new Date().toISOString();
  for (const v of incoming) {
    const step = plan.steps.find((s) => s.id === v.step_id);
    step.results = step.results ?? [];
    step.results.push({ tester, verdict: v.verdict, ts });
    if (step.results.length > 20) step.results = step.results.slice(-20);
  }
  // Record the submission event so the agent can see "tester X completed
  // a round" rather than inferring from per-step timestamps.
  plan.submissions = plan.submissions ?? [];
  plan.submissions.push({
    tester, ts, count: incoming.length,
    verdicts: incoming.reduce((a, v) => ({ ...a, [v.verdict]: (a[v.verdict] || 0) + 1 }), {}),
  });
  if (plan.submissions.length > 50) plan.submissions = plan.submissions.slice(-50);

  await writePlanAtomic(slug, plan);
  sendJson(res, 200, { ok: true, plan: stripCommentBodies(plan), summary: summarizePlan(plan) });
};

// POST /api/test-plans/<slug>/attachment
// Tester uploads a screenshot as base64-in-JSON. Multipart would be more
// efficient but requires extra parsing — keeping the zero-dep server
// simple. Returns { url } that the tester then attaches to a comment.
// File saved under ATTACHMENTS_DIR/<slug>/<random>.<ext>; URL served
// back via the matching GET endpoint.
const ALLOWED_MIME = new Map([
  ['image/png', 'png'],
  ['image/jpeg', 'jpg'],
  ['image/webp', 'webp'],
]);
const handleAttachmentUpload = async (slug, req, res) => {
  if (!validSlug(slug)) return sendJson(res, 400, { ok: false, error: 'invalid slug' });
  let body;
  try { body = await readJsonBody(req, MAX_ATTACHMENT_BYTES + 1024 * 1024); }
  catch (err) { return sendJson(res, 400, { ok: false, error: err.message }); }

  const mime = typeof body.mime === 'string' ? body.mime.toLowerCase() : '';
  const ext = ALLOWED_MIME.get(mime);
  if (!ext) return sendJson(res, 400, { ok: false, error: 'mime must be image/png, image/jpeg, or image/webp' });

  // Strip the data URL prefix if present (e.g. "data:image/png;base64,...")
  const raw = typeof body.data === 'string' ? body.data : '';
  const b64 = raw.includes(',') ? raw.split(',', 2)[1] : raw;
  let buf;
  try { buf = Buffer.from(b64, 'base64'); }
  catch { return sendJson(res, 400, { ok: false, error: 'invalid base64 data' }); }
  if (buf.length === 0)
    return sendJson(res, 400, { ok: false, error: 'empty file' });
  if (buf.length > MAX_ATTACHMENT_BYTES)
    return sendJson(res, 400, { ok: false, error: `file too large (max ${MAX_ATTACHMENT_BYTES} bytes)` });

  const dir = join(ATTACHMENTS_DIR, slug);
  await mkdir(dir, { recursive: true });
  // Random filename keeps URLs unguessable enough that bookmark-share
  // doesn't expose other comments' attachments unless the tester explicitly
  // re-shares the link. Plus avoids any client-supplied path traversal.
  const id = Date.now().toString(36) + '-' +
    Math.random().toString(36).slice(2, 10);
  const filename = `${id}.${ext}`;
  await writeFile(join(dir, filename), buf);

  // Public URL the dashboard / agent can fetch.
  sendJson(res, 200, {
    ok: true,
    url: `/api/test-plans/${slug}/attachment/${filename}`,
    bytes: buf.length,
    mime,
  });
};

// GET /api/test-plans/<slug>/attachment/<filename>
// Serves the uploaded image. No auth — dashboard is operator's network /
// shared with explicit testers; URLs are unguessable random IDs.
const ATTACHMENT_FILENAME_RE = /^[a-z0-9-]+\.(png|jpg|webp)$/;
const handleAttachmentGet = async (slug, filename, res) => {
  if (!validSlug(slug)) return sendJson(res, 400, { ok: false, error: 'invalid slug' });
  if (!ATTACHMENT_FILENAME_RE.test(filename))
    return sendJson(res, 400, { ok: false, error: 'invalid filename' });
  try {
    const data = await readFile(join(ATTACHMENTS_DIR, slug, filename));
    const ext = filename.split('.').pop();
    const mime = ext === 'png' ? 'image/png'
      : ext === 'webp' ? 'image/webp' : 'image/jpeg';
    res.writeHead(200, { 'content-type': mime, 'cache-control': 'public, max-age=3600' });
    res.end(data);
  } catch (err) {
    if (err.code === 'ENOENT') { res.writeHead(404); res.end('Not Found'); return; }
    res.writeHead(500); res.end('Server Error');
  }
};

// POST /api/test-plans/<slug>/step/<id>/comment
// Tester free-form comment per step. CRITICAL: this body is NOT
// surfaced to the LLM via rl_test_plan_status / rl_test_plan_wait
// (it's filtered out server-side from the agent's view). Instead,
// the operator pulls comments via a separate path and reviews/posts
// to the Linear story manually — keeping LLM-injection surface zero
// while still giving testers a free-text channel. See linear_story_id
// field on the plan if/when the agent wants to attach the comments.
const handleTestPlanStepComment = async (slug, stepIdRaw, req, res) => {
  if (!validSlug(slug)) return sendJson(res, 400, { ok: false, error: 'invalid slug' });
  const stepId = parseInt(stepIdRaw, 10);
  if (!Number.isInteger(stepId) || stepId < 1)
    return sendJson(res, 400, { ok: false, error: 'invalid step id' });

  let body;
  try { body = await readJsonBody(req); }
  catch (err) { return sendJson(res, 400, { ok: false, error: err.message }); }

  const text = typeof body.body === 'string' ? body.body.trim().slice(0, 2000) : '';
  // text + attachment combined check happens after we know the step exists.
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

  // Comment body can be empty IF an attachment is included (screenshot-only).
  const attachmentUrl = typeof body.attachment_url === 'string' ? body.attachment_url.slice(0, 500) : null;
  if (text.length === 0 && !attachmentUrl)
    return sendJson(res, 400, { ok: false, error: 'comment body or attachment required' });

  step.comments = step.comments ?? [];
  step.comments.push({
    tester,
    body: text,
    attachment_url: attachmentUrl,
    ts: new Date().toISOString(),
  });
  if (step.comments.length > 50) step.comments = step.comments.slice(-50);

  await writePlanAtomic(slug, plan);
  // Return summary only — don't echo the comment body in the response
  // since this endpoint sits on the same path family as the LLM-facing
  // ones and we want a consistent contract.
  sendJson(res, 200, { ok: true, summary: summarizePlan(plan) });
};

// POST /api/test-plans/<slug>/step/<id>/reset-request
// Tester signals "this step needs a reset before I can verify it again." We
// append a request with the tester's name and timestamp; the agent reads
// pending requests via rl_test_plan_status. Constrained signal — no
// free-form text from the tester.
const handleTestPlanStepResetRequest = async (slug, stepIdRaw, req, res) => {
  if (!validSlug(slug)) return sendJson(res, 400, { ok: false, error: 'invalid slug' });
  const stepId = parseInt(stepIdRaw, 10);
  if (!Number.isInteger(stepId) || stepId < 1)
    return sendJson(res, 400, { ok: false, error: 'invalid step id' });

  let body;
  try { body = await readJsonBody(req); }
  catch (err) { return sendJson(res, 400, { ok: false, error: err.message }); }
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

  step.reset_requests = step.reset_requests ?? [];
  step.reset_requests.push({
    tester,
    ts: new Date().toISOString(),
    status: 'pending',
  });
  if (step.reset_requests.length > 20) step.reset_requests = step.reset_requests.slice(-20);

  await writePlanAtomic(slug, plan);
  sendJson(res, 200, { ok: true, plan: stripCommentBodies(plan), summary: summarizePlan(plan) });
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
  sendJson(res, 200, { ok: true, plan: stripCommentBodies(plan), summary: summarizePlan(plan) });
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
const RE_RESET = /^\/api\/test-plans\/([a-z0-9-]+)\/step\/(\d+)\/reset-request$/;
const RE_COMMENT = /^\/api\/test-plans\/([a-z0-9-]+)\/step\/(\d+)\/comment$/;
const RE_SUBMIT = /^\/api\/test-plans\/([a-z0-9-]+)\/submit$/;
const RE_ATTACH_POST = /^\/api\/test-plans\/([a-z0-9-]+)\/attachment$/;
const RE_ATTACH_GET = /^\/api\/test-plans\/([a-z0-9-]+)\/attachment\/([A-Za-z0-9.-]+)$/;

const server = createServer(async (req, res) => {
  // Split path from query so the route regexes (which use $) still match
  // when the client appends ?include_comments=1 etc. The full req.url
  // stays available via req.url (handlers that need the query string
  // — handleTestPlanGet → planForResponse — re-inspect it directly).
  const pathOnly = (req.url || '').split('?', 1)[0];
  // Liveness probe for compose healthchecks / orchestrator pings.
  if (pathOnly === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"ok":true}');
    return;
  }
  if (pathOnly === '/api/state') {
    await handleApiState(res);
    return;
  }
  if (pathOnly === '/api/test-plans' && req.method === 'GET') {
    await handleTestPlanList(res);
    return;
  }
  const planMatch = RE_PLAN.exec(pathOnly);
  if (planMatch) {
    const slug = planMatch[1];
    if (req.method === 'GET') return handleTestPlanGet(slug, req, res);
    if (req.method === 'PUT' || req.method === 'POST') return handleTestPlanPut(slug, req, res);
    if (req.method === 'DELETE') return handleTestPlanDelete(slug, res);
    res.writeHead(405); res.end('Method Not Allowed'); return;
  }
  const stepMatch = RE_STEP.exec(pathOnly);
  if (stepMatch) {
    if (req.method !== 'POST') { res.writeHead(405); res.end('Method Not Allowed'); return; }
    return handleTestPlanStepResult(stepMatch[1], stepMatch[2], req, res);
  }
  const resetMatch = RE_RESET.exec(pathOnly);
  if (resetMatch) {
    if (req.method !== 'POST') { res.writeHead(405); res.end('Method Not Allowed'); return; }
    return handleTestPlanStepResetRequest(resetMatch[1], resetMatch[2], req, res);
  }
  const commentMatch = RE_COMMENT.exec(pathOnly);
  if (commentMatch) {
    if (req.method !== 'POST') { res.writeHead(405); res.end('Method Not Allowed'); return; }
    return handleTestPlanStepComment(commentMatch[1], commentMatch[2], req, res);
  }
  const submitMatch = RE_SUBMIT.exec(pathOnly);
  if (submitMatch) {
    if (req.method !== 'POST') { res.writeHead(405); res.end('Method Not Allowed'); return; }
    return handleTestPlanSubmit(submitMatch[1], req, res);
  }
  const attachPostMatch = RE_ATTACH_POST.exec(pathOnly);
  if (attachPostMatch) {
    if (req.method !== 'POST') { res.writeHead(405); res.end('Method Not Allowed'); return; }
    return handleAttachmentUpload(attachPostMatch[1], req, res);
  }
  const attachGetMatch = RE_ATTACH_GET.exec(pathOnly);
  if (attachGetMatch) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405); res.end('Method Not Allowed'); return;
    }
    return handleAttachmentGet(attachGetMatch[1], attachGetMatch[2], res);
  }
  await serveStatic(req, res);
});

server.listen(PORT, '0.0.0.0', () => {
  // eslint-disable-next-line no-console
  console.log(`rl-dashboard listening on :${PORT}, state=${STATE_DIR}, public=${PUBLIC_DIR}`);
});
