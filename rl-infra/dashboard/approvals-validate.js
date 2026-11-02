// ROK-1900 — approval item schema (v1) validation. Pure: no fs, no network.
//
// Every field of a submitted item, ruling, verdict and withdrawal is checked
// against the spec's item schema, and unknown keys are rejected at every
// level. Free text (summaries, questions, operator notes) is stored verbatim
// and NEVER interpreted here or downstream — it is opaque, untrusted data.
// Agents read operator notes only through a disposable lane (spec D11).

export const ID_RE = /^\d{4}-\d{2}-\d{2}-\d{4}-[0-9a-f]{4}$/;
export const KINDS = Object.freeze(['mockup', 'prototype', 'ruling', 'spike']);
export const VERDICT_STATUS = Object.freeze({
  approve: 'approved', changes: 'changes_requested', reject: 'rejected',
});
export const LIST_FILTERS = Object.freeze(['pending', 'decided', 'all']);
export const LIMITS = Object.freeze({
  title: 120, summary: 600, question: 1000, recommendation: 1000, note: 1000,
  questions: 20, options: 6, optionLabel: 120, links: 5, linkLabel: 80, url: 500,
  specPath: 300, caption: 200, reason: 500, screenshotName: 100,
  mockupBytes: 512 * 1024, specBytes: 256 * 1024,
  screenshots: 8, screenshotBytes: 5 * 1024 * 1024,
});

// "ROK-1900", or a spike slug such as "SATISFACTORY-hub-plugin".
const STORY_RE = /^[A-Za-z0-9][A-Za-z0-9-]{2,39}$/;
const ASKED_BY_RE = /^[A-Za-z0-9 _.-]{1,60}$/;
const OPTION_KEY_RE = /^[a-z0-9][a-z0-9_-]{0,19}$/;
const SPEC_PATH_RE = /^[A-Za-z0-9_./-]+$/;
const SCREENSHOT_NAME_RE = /^[A-Za-z0-9 _.()-]+$/;
const B64_RE = /^[A-Za-z0-9+/]*={0,2}$/;
const RESERVED_CHOICES = Object.freeze(['accept', 'other']);

export class ApprovalError extends Error {
  constructor(status, code, detail = null) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'ApprovalError';
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

const bad = (detail) => new ApprovalError(400, 'invalid_request', detail);

const isPlainObject = (v) =>
  v !== null && typeof v === 'object' && !Array.isArray(v)
  && Object.getPrototypeOf(v) === Object.prototype;

export const checkKeys = (obj, allowed, where) => {
  if (!isPlainObject(obj)) throw bad(`${where} must be an object`);
  for (const k of Object.keys(obj)) {
    if (!allowed.includes(k)) throw bad(`${where}: unknown key "${k}"`);
  }
};

// Required text must be non-blank; optional text may be absent/null/"" (→ null).
const text = (v, max, where, required = true) => {
  if (v === undefined || v === null || v === '') {
    if (required) throw bad(`${where} is required`);
    return null;
  }
  if (typeof v !== 'string') throw bad(`${where} must be a string`);
  if (required && v.trim().length === 0) throw bad(`${where} must not be blank`);
  if (v.length > max) throw bad(`${where} exceeds ${max} chars`);
  return v;
};

const matching = (v, re, max, where, required = true) => {
  const s = text(v, max, where, required);
  if (s !== null && !re.test(s)) throw bad(`${where} has an invalid format`);
  return s;
};

const array = (v, max, where, min = 0) => {
  if (!Array.isArray(v)) throw bad(`${where} must be an array`);
  if (v.length < min) throw bad(`${where} needs at least ${min} entr${min === 1 ? 'y' : 'ies'}`);
  if (v.length > max) throw bad(`${where} allows at most ${max} entries`);
  return v;
};

const validateOptions = (raw, where) => {
  const seen = new Set();
  return array(raw, LIMITS.options, where).map((o, i) => {
    const at = `${where}[${i}]`;
    checkKeys(o, ['key', 'label'], at);
    const key = matching(o.key, OPTION_KEY_RE, 20, `${at}.key`);
    if (RESERVED_CHOICES.includes(key)) throw bad(`${at}.key "${key}" is reserved`);
    if (seen.has(key)) throw bad(`${at}.key "${key}" is duplicated`);
    seen.add(key);
    return { key, label: text(o.label, LIMITS.optionLabel, `${at}.label`) };
  });
};

const validateQuestion = (q, i) => {
  const at = `questions[${i}]`;
  checkKeys(q, ['text', 'recommendation', 'options'], at);
  const out = {
    n: i + 1,
    text: text(q.text, LIMITS.question, `${at}.text`),
    recommendation: text(q.recommendation, LIMITS.recommendation, `${at}.recommendation`),
  };
  if (q.options !== undefined) out.options = validateOptions(q.options, `${at}.options`);
  return out;
};

const validateLink = (l, i) => {
  const at = `links[${i}]`;
  checkKeys(l, ['label', 'url'], at);
  const label = text(l.label, LIMITS.linkLabel, `${at}.label`);
  const url = text(l.url, LIMITS.url, `${at}.url`);
  let parsed;
  try { parsed = new URL(url); } catch { throw bad(`${at}.url is not a URL`); }
  if (parsed.protocol !== 'https:') throw bad(`${at}.url must be https`);
  if (parsed.username || parsed.password) throw bad(`${at}.url must not carry credentials`);
  return { label, url };
};

const ITEM_KEYS = ['story', 'title', 'kind', 'summary', 'questions', 'spec_path',
  'links', 'supersedes', 'asked_by', 'files'];

// Returns { fields, files } for a new item. id/status/rulings/verdict are
// server-owned, so sending them is an unknown-key 400.
export const validateNewItem = (body) => {
  checkKeys(body, ITEM_KEYS, 'item');
  if (!KINDS.includes(body.kind)) throw bad(`kind must be one of ${KINDS.join(', ')}`);
  const fields = {
    story: matching(body.story, STORY_RE, 40, 'story'),
    title: text(body.title, LIMITS.title, 'title'),
    kind: body.kind,
    summary: text(body.summary, LIMITS.summary, 'summary', false) ?? '',
    asked_by: matching(body.asked_by, ASKED_BY_RE, 60, 'asked_by', false) ?? 'agent',
    questions: array(body.questions, LIMITS.questions, 'questions', 1).map(validateQuestion),
    spec_path: matching(body.spec_path, SPEC_PATH_RE, LIMITS.specPath, 'spec_path', false),
    links: body.links === undefined ? [] : array(body.links, LIMITS.links, 'links').map(validateLink),
    supersedes: matching(body.supersedes, ID_RE, 20, 'supersedes', false),
  };
  if (fields.spec_path?.split('/').includes('..')) throw bad('spec_path must not contain ".."');
  return { fields, files: validateFiles(body.files) };
};

// Magic-byte sniff: the extension is chosen from the bytes, never the name.
export const sniffImage = (buf) => {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null;
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  const riff = buf.toString('latin1', 0, 4) === 'RIFF';
  if (riff && buf.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  return null;
};

const sized = (s, max, where, tooLarge) => {
  if (typeof s !== 'string' || s.length === 0) throw bad(`${where} must be a non-empty string`);
  if (Buffer.byteLength(s, 'utf8') > max) throw new ApprovalError(413, tooLarge, `${where} exceeds ${max} bytes`);
  return s;
};

const validateScreenshot = (s, i) => {
  const at = `files.screenshots[${i}]`;
  checkKeys(s, ['name', 'b64', 'caption'], at);
  matching(s.name, SCREENSHOT_NAME_RE, LIMITS.screenshotName, `${at}.name`, false);
  const caption = text(s.caption, LIMITS.caption, `${at}.caption`, false);
  if (typeof s.b64 !== 'string' || s.b64.length % 4 !== 0 || !B64_RE.test(s.b64)) {
    throw bad(`${at}.b64 is not base64`);
  }
  const data = Buffer.from(s.b64, 'base64');
  if (data.length > LIMITS.screenshotBytes) {
    throw new ApprovalError(413, 'screenshot_too_large', `${at} exceeds ${LIMITS.screenshotBytes} bytes`);
  }
  const ext = sniffImage(data);
  if (!ext) throw new ApprovalError(400, 'invalid_screenshot', `${at} is not a PNG, JPEG or WebP`);
  return { ext, data, caption };
};

export const validateFiles = (files) => {
  if (files === undefined || files === null) return { mockup: null, spec: null, screenshots: [] };
  checkKeys(files, ['mockup_html', 'spec_md', 'screenshots'], 'files');
  const opt = (v, fn) => (v === undefined || v === null ? null : fn(v));
  return {
    mockup: opt(files.mockup_html, (v) => sized(v, LIMITS.mockupBytes, 'files.mockup_html', 'mockup_too_large')),
    spec: opt(files.spec_md, (v) => sized(v, LIMITS.specBytes, 'files.spec_md', 'spec_too_large')),
    screenshots: opt(files.screenshots, (v) =>
      array(v, LIMITS.screenshots, 'files.screenshots').map(validateScreenshot)) ?? [],
  };
};

// A ruling names an existing question; "other" requires a note.
export const validateRuling = (item, body) => {
  checkKeys(body, ['n', 'choice', 'note'], 'ruling');
  const q = Number.isInteger(body.n) ? item.questions.find((x) => x.n === body.n) : undefined;
  if (!q) throw bad('ruling.n does not name a question on this item');
  const choices = [...RESERVED_CHOICES, ...(q.options ?? []).map((o) => o.key)];
  if (typeof body.choice !== 'string' || !choices.includes(body.choice)) {
    throw bad(`ruling.choice must be one of ${choices.join(', ')}`);
  }
  const note = text(body.note, LIMITS.note, 'ruling.note', body.choice === 'other');
  return { n: q.n, choice: body.choice, note };
};

// "changes" and "reject" require a note.
export const validateVerdict = (body) => {
  checkKeys(body, ['value', 'note'], 'verdict');
  if (!Object.hasOwn(VERDICT_STATUS, body.value)) {
    throw bad(`verdict.value must be one of ${Object.keys(VERDICT_STATUS).join(', ')}`);
  }
  const note = text(body.note, LIMITS.note, 'verdict.note', body.value !== 'approve');
  return { value: body.value, note };
};

export const validateWithdraw = (body) => {
  checkKeys(body ?? {}, ['reason', 'superseded_by'], 'withdraw');
  return {
    reason: text(body?.reason, LIMITS.reason, 'withdraw.reason', false),
    superseded_by: matching(body?.superseded_by, ID_RE, 20, 'withdraw.superseded_by', false),
  };
};

// Default read shape (spec D11): note text replaced by has_note. Only a read
// with the agent token AND include_notes gets the raw item.
export const redactNotes = (item) => {
  const strip = ({ note, ...rest }) => ({ ...rest, has_note: typeof note === 'string' && note.length > 0 });
  return {
    ...item,
    rulings: (item.rulings ?? []).map(strip),
    verdict: item.verdict ? strip(item.verdict) : null,
  };
};
