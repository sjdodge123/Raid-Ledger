// ROK-1900 — filesystem store for the "Pending approval" inbox.
//
// Layout under the root (default /state/approvals — its own RW mount, outside
// test-plans, so plan-prune / env-destroy / rl_test_plan_clear never reach it):
//   <id>/item.json          the item record (schema v1)
//   <id>/files/mockup.html  optional, as uploaded
//   <id>/files/shot-N.<ext> optional screenshots, renamed server-side
//   <id>/files/spec.md      optional spec text
//   _events.log             append-only JSONL: submit / rule / verdict / withdraw
//
// item.json is always written tmp + rename (atomic on one filesystem), and
// written LAST on create, so a listed item always has its files. Nothing is
// ever deleted: decided items stay on disk and move to the archive filter.
// Read-modify-write ops are serialised per item with an in-process lock.
import { appendFile, mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import {
  ApprovalError, ID_RE, LIST_FILTERS, VERDICT_STATUS,
  validateNewItem, validateRuling, validateVerdict, validateWithdraw,
} from './approvals-validate.js';

export const DEFAULT_ROOT = '/state/approvals';
const ITEM_FILE = 'item.json';
const EVENTS_FILE = '_events.log';
const IP_RE = /^[0-9A-Fa-f:.]{1,64}$/;
const LOCKS = new Map();

const pad = (n) => String(n).padStart(2, '0');
const isoSeconds = (d) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');

// YYYY-MM-DD-HHmm-xxxx (UTC) — the same shape as test-plan ids.
export const makeId = (date, hex) =>
  `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
  + `-${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}-${hex}`;

const withLock = (root, id, fn) => {
  const key = `${root}\0${id}`;
  const run = (LOCKS.get(key) ?? Promise.resolve()).then(fn);
  const tail = run.catch(() => {});
  LOCKS.set(key, tail);
  tail.then(() => { if (LOCKS.get(key) === tail) LOCKS.delete(key); });
  return run;
};

const writeJsonAtomic = async (dir, name, obj) => {
  const tmp = join(dir, `.${name}.${process.pid}.${Date.now()}.${randomBytes(3).toString('hex')}.tmp`);
  await writeFile(tmp, `${JSON.stringify(obj, null, 2)}\n`);
  await rename(tmp, join(dir, name));
};

const assertId = (id) => {
  if (typeof id !== 'string' || !ID_RE.test(id)) throw new ApprovalError(400, 'invalid_id', 'malformed approval id');
};

const readItem = async (cfg, id) => {
  assertId(id);
  let raw;
  try {
    raw = await readFile(join(cfg.root, id, ITEM_FILE), 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') throw new ApprovalError(404, 'not_found', id);
    throw err;
  }
  return JSON.parse(raw);
};

const saveItem = (cfg, item) => writeJsonAtomic(join(cfg.root, item.id), ITEM_FILE, item);

const appendEvent = async (cfg, event, meta) => {
  const ip = typeof meta?.ip === 'string' && IP_RE.test(meta.ip) ? meta.ip : null;
  const line = JSON.stringify({ ts: isoSeconds(cfg.now()), ...event, ip });
  await appendFile(join(cfg.root, EVENTS_FILE), `${line}\n`);
};

const assertPending = (item) => {
  if (item.status !== 'pending') throw new ApprovalError(409, 'decided', `item is ${item.status}`);
};

// Creates <root>/<id>/ exclusively; a collision (same minute + same hex) retries.
const allocateDir = async (cfg) => {
  await mkdir(cfg.root, { recursive: true });
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const id = makeId(cfg.now(), cfg.randomHex());
    try {
      await mkdir(join(cfg.root, id));
      return id;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
    }
  }
  throw new ApprovalError(503, 'id_exhausted', 'could not allocate an approval id');
};

const writeFiles = async (dir, files) => {
  const attachments = { mockup: null, screenshots: [], spec: null };
  const hasAny = files.mockup !== null || files.spec !== null || files.screenshots.length > 0;
  if (!hasAny) return attachments;
  await mkdir(dir, { recursive: true });
  if (files.mockup !== null) {
    await writeFile(join(dir, 'mockup.html'), files.mockup, 'utf8');
    attachments.mockup = 'mockup.html';
  }
  for (const [i, shot] of files.screenshots.entries()) {
    const file = `shot-${i + 1}.${shot.ext}`;
    await writeFile(join(dir, file), shot.data);
    attachments.screenshots.push({ file, caption: shot.caption });
  }
  if (files.spec !== null) {
    await writeFile(join(dir, 'spec.md'), files.spec, 'utf8');
    attachments.spec = 'spec.md';
  }
  return attachments;
};

const create = async (cfg, body, meta) => {
  const { fields, files } = validateNewItem(body);
  const id = await allocateDir(cfg);
  const attachments = await writeFiles(join(cfg.root, id, 'files'), files);
  const { questions, spec_path: specPath, links, supersedes, ...head } = fields;
  const item = {
    schema: 1, id, story: head.story, title: head.title, kind: head.kind, summary: head.summary,
    created_at: isoSeconds(cfg.now()), asked_by: head.asked_by, questions, attachments,
    spec_path: specPath, links, supersedes,
    status: 'pending', rulings: [], verdict: null, decided_at: null,
  };
  await saveItem(cfg, item);
  await appendEvent(cfg, { id, action: 'submit', actor: 'agent' }, meta);
  return item;
};

export const summarize = (item) => ({
  id: item.id, story: item.story, title: item.title, kind: item.kind,
  asked_by: item.asked_by, created_at: item.created_at, status: item.status,
  decided_at: item.decided_at ?? null,
  question_count: item.questions.length, ruled_count: item.rulings.length,
  has_mockup: item.attachments.mockup !== null,
  screenshot_count: item.attachments.screenshots.length,
});

const readAll = async (cfg) => {
  let names;
  try {
    names = await readdir(cfg.root);
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  const items = [];
  for (const name of names.filter((n) => ID_RE.test(n))) {
    try { items.push(await readItem(cfg, name)); } catch { /* half-written or corrupt: skip */ }
  }
  return items;
};

// filter: pending (default) | decided (the archive) | all. Newest first.
const list = async (cfg, { status = 'pending' } = {}) => {
  if (!LIST_FILTERS.includes(status)) {
    throw new ApprovalError(400, 'invalid_request', `status must be one of ${LIST_FILTERS.join(', ')}`);
  }
  const all = await readAll(cfg);
  const pending = all.filter((i) => i.status === 'pending').length;
  const keep = (i) => status === 'all' || (status === 'pending') === (i.status === 'pending');
  const items = all.filter(keep)
    .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id))
    .map(summarize);
  return { items, counts: { pending, decided: all.length - pending } };
};

// Re-ruling a question before the verdict replaces that question's ruling.
const rule = (cfg, id, body, meta) => withLock(cfg.root, id, async () => {
  const item = await readItem(cfg, id);
  assertPending(item);
  const r = validateRuling(item, body);
  const ts = isoSeconds(cfg.now());
  item.rulings = [...item.rulings.filter((x) => x.n !== r.n), { ...r, ts }].sort((a, b) => a.n - b.n);
  await saveItem(cfg, item);
  await appendEvent(cfg, { id, action: 'rule', actor: 'operator', n: r.n }, meta);
  return item;
});

// approve rules every unruled question "accept" (one-tap approve all).
const verdict = (cfg, id, body, meta) => withLock(cfg.root, id, async () => {
  const item = await readItem(cfg, id);
  assertPending(item);
  const v = validateVerdict(body);
  const ts = isoSeconds(cfg.now());
  if (v.value === 'approve') {
    const ruled = new Set(item.rulings.map((r) => r.n));
    const auto = item.questions.filter((q) => !ruled.has(q.n))
      .map((q) => ({ n: q.n, choice: 'accept', note: null, ts }));
    item.rulings = [...item.rulings, ...auto].sort((a, b) => a.n - b.n);
  }
  Object.assign(item, { verdict: { ...v, ts }, status: VERDICT_STATUS[v.value], decided_at: ts });
  await saveItem(cfg, item);
  await appendEvent(cfg, { id, action: 'verdict', actor: 'operator', value: v.value }, meta);
  return item;
});

// Agent-side close: withdrawn, or superseded when superseded_by is given.
// The reason travels in the events log only (it is not an item.json field).
const withdraw = (cfg, id, body, meta) => withLock(cfg.root, id, async () => {
  const item = await readItem(cfg, id);
  assertPending(item);
  const w = validateWithdraw(body);
  const ts = isoSeconds(cfg.now());
  Object.assign(item, { status: w.superseded_by ? 'superseded' : 'withdrawn', decided_at: ts });
  await saveItem(cfg, item);
  const event = { id, action: 'withdraw', actor: 'agent', reason: w.reason, superseded_by: w.superseded_by };
  await appendEvent(cfg, event, meta);
  return item;
});

// Absolute path of an attachment, only when the item actually lists it.
const filePath = async (cfg, id, name) => {
  const item = await readItem(cfg, id);
  const { mockup, spec, screenshots } = item.attachments;
  const known = [mockup, spec, ...screenshots.map((s) => s.file)].filter(Boolean);
  if (typeof name !== 'string' || !known.includes(name)) throw new ApprovalError(404, 'not_found', 'no such file');
  return join(cfg.root, id, 'files', name);
};

// The item's spec.md as text (null when it has none). The page renders it
// from GET /api/approvals/<id>; the raw file is never served (spec D8).
const readSpec = async (cfg, id) => {
  const item = await readItem(cfg, id);
  if (!item.attachments.spec) return null;
  return readFile(join(cfg.root, id, 'files', item.attachments.spec), 'utf8');
};

const readEvents = async (cfg) => {
  let raw;
  try { raw = await readFile(join(cfg.root, EVENTS_FILE), 'utf8'); } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  return raw.split('\n').filter(Boolean).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } });
};

// No delete method exists, by design (spec D1 / AC11).
export const createApprovalStore = ({
  root = DEFAULT_ROOT,
  now = () => new Date(),
  randomHex = () => randomBytes(2).toString('hex'),
} = {}) => {
  const cfg = Object.freeze({ root, now, randomHex });
  return Object.freeze({
    root,
    create: (body, meta) => create(cfg, body, meta),
    get: (id) => readItem(cfg, id),
    list: (opts) => list(cfg, opts),
    rule: (id, body, meta) => rule(cfg, id, body, meta),
    verdict: (id, body, meta) => verdict(cfg, id, body, meta),
    withdraw: (id, body, meta) => withdraw(cfg, id, body, meta),
    filePath: (id, name) => filePath(cfg, id, name),
    readSpec: (id) => readSpec(cfg, id),
    readEvents: () => readEvents(cfg),
  });
};
