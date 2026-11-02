// ROK-1900 — JSON routes for the "Pending approval" inbox (spec "API routes").
//
//   POST /api/approvals                    agent  submit         201 {ok, id, item_url}
//   GET  /api/approvals?status=…           read   list           {ok, items, plan_steps, counts}
//   GET  /api/approvals/<id>               read   item           notes redacted unless agent + include_notes=1
//   POST /api/approvals/<id>/ruling        inbox  rule one Q     {ok, item} (notes included)
//   POST /api/approvals/<id>/verdict       inbox  decide         {ok, item}
//   POST /api/approvals/<id>/withdraw      agent  withdraw       {ok, status, item}
//
// Auth runs BEFORE any body is read. Nothing is ever deleted: DELETE (or any
// other method) on an approval path is 405. Writes are rate-limited by the
// dispatcher (rateLimitOk) before this handler runs. File serving
// (/approvals-content/) and the plan-step join live in other modules.
import { ApprovalError, ID_RE, LIMITS, redactNotes } from './approvals-validate.js';

// Submit: every attachment at its cap, screenshots base64-inflated, + slack
// for the JSON fields. Rulings / verdicts / withdraw are tiny.
const b64 = (n) => Math.ceil(n / 3) * 4;
export const SUBMIT_MAX_BYTES = b64(LIMITS.mockupBytes * 2) + b64(LIMITS.specBytes * 2)
  + LIMITS.screenshots * b64(LIMITS.screenshotBytes) + 256 * 1024;
export const SMALL_MAX_BYTES = 16 * 1024;

const ITEM_PATH_RE = /^\/api\/approvals\/([^/]+)(?:\/(ruling|verdict|withdraw))?$/;
const ACTIONS = Object.freeze({ ruling: 'rule', verdict: 'verdict', withdraw: 'withdraw' });
const ACTION_AUTH = Object.freeze({ ruling: 'inbox', verdict: 'inbox', withdraw: 'agent' });

const sendJson = (res, status, body, extra = {}) => {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', ...extra });
  res.end(JSON.stringify(body));
};

const sendError = (res, status, error, detail = null) =>
  sendJson(res, status, { ok: false, error, ...(detail ? { detail } : {}) },
    status === 413 ? { connection: 'close' } : {});

const isJsonContentType = (ct) =>
  typeof ct === 'string' && ct.split(';', 1)[0].trim().toLowerCase() === 'application/json';

// Reads a JSON object body under `max` bytes. Over the cap: stop buffering,
// drain, reject 413 (a declared content-length over the cap rejects at once).
export const readBody = (req, max) => new Promise((resolve, reject) => {
  if (!isJsonContentType(req.headers?.['content-type'])) {
    reject(new ApprovalError(415, 'unsupported_media_type', 'Content-Type must be application/json'));
    return;
  }
  const declared = Number(req.headers?.['content-length']);
  if (Number.isFinite(declared) && declared > max) {
    req.resume();
    reject(new ApprovalError(413, 'body_too_large', `max ${max} bytes`));
    return;
  }
  let size = 0;
  let over = false;
  const chunks = [];
  req.on('data', (c) => {
    size += c.length;
    if (size > max) { over = true; chunks.length = 0; return; }
    if (!over) chunks.push(c);
  });
  req.on('end', () => {
    if (over) { reject(new ApprovalError(413, 'body_too_large', `max ${max} bytes`)); return; }
    let parsed;
    try { parsed = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch {
      reject(new ApprovalError(400, 'invalid_json', 'body is not valid JSON'));
      return;
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      reject(new ApprovalError(400, 'invalid_request', 'body must be a JSON object'));
      return;
    }
    resolve(parsed);
  });
  req.on('error', reject);
});

const queryOf = (req) => new URLSearchParams((req.url || '').split('?')[1] ?? '');

const itemUrl = (publicDomain, id) =>
  `${publicDomain ? `https://fleet.${publicDomain}` : 'http://fleet.rl.lan'}/?approval=${id}`;

const methodNotAllowed = (res, allow) => {
  res.writeHead(405, { 'content-type': 'application/json', allow });
  res.end(JSON.stringify({ ok: false, error: 'method_not_allowed' }));
};

const handleSubmit = async (ctx, req, res) => {
  const body = await readBody(req, SUBMIT_MAX_BYTES);
  const item = await ctx.store.create(body, { ip: ctx.ipOf(req) });
  sendJson(res, 201, { ok: true, id: item.id, item_url: itemUrl(ctx.publicDomain, item.id) });
};

const handleList = async (ctx, req, res) => {
  const status = queryOf(req).get('status') || 'pending';
  const { items, counts } = await ctx.store.list({ status });
  const planSteps = await ctx.planSteps(req);
  sendJson(res, 200, { ok: true, items, plan_steps: planSteps, counts });
};

// Notes are untrusted operator text (spec D11): only an agent that asks for
// them explicitly gets them; every other read sees has_note only.
const handleGet = async (ctx, id, req, res) => {
  const item = await ctx.store.get(id);
  const wantNotes = queryOf(req).get('include_notes') === '1' && ctx.auth.isAgent(req);
  const specMd = typeof ctx.store.readSpec === 'function' ? await ctx.store.readSpec(id) : null;
  sendJson(res, 200, { ok: true, item: wantNotes ? item : redactNotes(item), spec_md: specMd });
};

const handleAction = async (ctx, id, action, req, res) => {
  const body = await readBody(req, SMALL_MAX_BYTES);
  const item = await ctx.store[ACTIONS[action]](id, body, { ip: ctx.ipOf(req) });
  if (action === 'withdraw') {
    sendJson(res, 200, { ok: true, status: item.status, item: redactNotes(item) });
    return;
  }
  sendJson(res, 200, { ok: true, item });
};

// Resolves { need, run } | { need, badId } | { allow } (405) | { notFound }.
const route = (ctx, req, res, pathOnly) => {
  const m = req.method;
  if (pathOnly === '/api/approvals') {
    if (m === 'POST') return { need: 'agent', run: () => handleSubmit(ctx, req, res) };
    if (m === 'GET') return { need: 'read', run: () => handleList(ctx, req, res) };
    return { allow: 'GET, POST' };
  }
  const match = pathOnly.match(ITEM_PATH_RE);
  if (!match) return { notFound: true };
  const [, id = '', action] = match;
  if (!action) {
    if (m !== 'GET') return { allow: 'GET' };
    if (!ID_RE.test(id)) return { need: 'read', badId: true };
    return { need: 'read', run: () => handleGet(ctx, id, req, res) };
  }
  if (m !== 'POST') return { allow: 'POST' };
  if (!ID_RE.test(id)) return { need: ACTION_AUTH[action], badId: true };
  return { need: ACTION_AUTH[action], run: () => handleAction(ctx, id, action, req, res) };
};

// Returns an async (req, res, pathOnly) => boolean — true when it answered.
export const createApprovalRoutes = ({
  store, auth, publicDomain = '', ipOf = () => null, planSteps = async () => [],
}) => {
  const ctx = Object.freeze({ store, auth, publicDomain, ipOf, planSteps });
  return async (req, res, pathOnly) => {
    if (pathOnly !== '/api/approvals' && !pathOnly.startsWith('/api/approvals/')) return false;
    const r = route(ctx, req, res, pathOnly);
    if (r.notFound) { sendError(res, 404, 'not_found'); return true; }
    if (r.allow) { methodNotAllowed(res, r.allow); return true; }
    const denial = auth.deny(req, r.need);
    if (denial) { sendError(res, denial.status, denial.error); return true; }
    if (r.badId) { sendError(res, 400, 'invalid_id', 'malformed approval id'); return true; }
    try {
      await r.run();
    } catch (err) {
      if (!(err instanceof ApprovalError)) throw err;
      sendError(res, err.status, err.code, err.detail);
    }
    return true;
  };
};
