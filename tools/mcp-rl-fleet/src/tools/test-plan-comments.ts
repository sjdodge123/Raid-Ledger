// ROK-1657 — tester-comment handling for rl_test_plan_status / rl_test_plan_wait.
//
// DEFAULT read (include_comments omitted or false): the dashboard is fetched
// WITHOUT ?include_comments=1 and returns per-comment METADATA only
// ({tester, ts, has_body, attachment_url}). Every comment is re-projected to
// exactly those fields here (defence in depth against a dashboard that ignores
// the query) and each step gains a `comment_count`. No free-form tester text,
// no base64 and no wrap tags reach the agent (operator rule 2026-05-18).
//
// OPT-IN read (include_comments:true, plan_id required): the dashboard returns
// each body base64-encoded inside `<untrusted-tester-comment encoding="base64">`.
// The TOOL decodes it here so the agent never decodes anything, then
// NFKC-normalises, turns U+2028/U+2029 into "\n", drops control characters
// except newline and tab, drops every invisible/format character (Cf, tag
// characters, variation selectors, default-ignorables, private-use,
// unassigned), replaces the wrap tag's own name with "[wrap-tag]" so a body
// cannot spell its close tag, replaces every "<" (and U+226E) with U+2039 and
// every ">" (and U+226F) with U+203A (no tag can form), caps each body at 500
// characters and the response at 4000 — the budget is spent NEWEST-first (by
// comment ts, across steps; output order is unchanged), so an older comment
// reached after it is spent gets `body: null`, counted once in a top-level
// `comment_bodies_omitted` — and emits
// `<untrusted-tester-comment>plain text</untrusted-tester-comment>` with no
// encoding attribute. When the dashboard withholds every body (the
// X-Agent-Token was missing or rejected) a top-level
// `comment_bodies_unavailable` says so. Only a disposable sub-agent lane sets
// include_comments.
//
// A 2xx body that is not JSON is never passed through: it becomes an
// `unparseable_dashboard_body` error whose raw body is withheld when it
// carries the wrap tag, exactly as on the non-2xx path.

export const COMMENT_BODY_CAP = 500;
export const COMMENT_TOTAL_CAP = 4000;
export const TRUNCATION_MARK = '…[truncated]';
export const UNDECODABLE_COMMENT = '[undecodable comment]';
const WRAP_OPEN = '<untrusted-tester-comment>';
const WRAP_CLOSE = '</untrusted-tester-comment>';
export const WITHHELD_RAW = '[withheld: tester-comment markup]';
export const BODIES_UNAVAILABLE =
  'dashboard returned no comment bodies: the X-Agent-Token was missing or rejected ' +
  '(RL_AGENT_TOKEN in the MCP server env must match the dashboard)';

type Json = Record<string, unknown>;
type Budget = { remaining: number; omitted: number };
type PlanFn = (plan: Json) => Json;

const isObj = (v: unknown): v is Json =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Dashboard path for a status read. `?include_comments=1` is appended ONLY
 * for a scoped (plan_id) read that explicitly opted in.
 */
export function statusPath(
  slugPath: string,
  planId: string | undefined,
  includeComments: boolean,
): string {
  if (!planId) return `/api/test-plans/${slugPath}`;
  const base = `/api/test-plans/${slugPath}/${planId}`;
  return includeComments ? `${base}?include_comments=1` : base;
}

/** Metadata-only projection of one comment — a `body` never survives it. */
export function commentMetadata(c: unknown): Json {
  const o = isObj(c) ? c : {};
  const hasBody =
    typeof o.has_body === 'boolean'
      ? o.has_body
      : typeof o.body === 'string' && o.body.length > 0;
  return {
    tester: o.tester ?? null,
    ts: o.ts ?? null,
    has_body: hasBody,
    attachment_url: o.attachment_url ?? null,
  };
}

/** Rewrite every step's comments with `fn` and stamp a per-step comment_count. */
function mapStepComments(plan: Json, fn: (c: unknown) => Json): Json {
  if (!Array.isArray(plan.steps)) return plan;
  return {
    ...plan,
    steps: plan.steps.map((s: unknown) => {
      if (!isObj(s)) return s;
      const comments = Array.isArray(s.comments) ? s.comments : [];
      return { ...s, comments: comments.map(fn), comment_count: comments.length };
    }),
  };
}

/**
 * Apply `fn` to every plan in a dashboard body: the scoped shape
 * (`{plan, summary}`), the list shape (`{plans:[...]}`) or a bare plan.
 */
function mapPlans(body: unknown, fn: PlanFn): unknown {
  if (!isObj(body)) return body;
  if (Array.isArray(body.steps)) return fn(body);
  const out: Json = { ...body };
  if (isObj(body.plan)) out.plan = fn(body.plan);
  if (Array.isArray(body.plans)) {
    out.plans = body.plans.map((p: unknown) => (isObj(p) ? fn(p) : p));
  }
  return out;
}

/** Default path: metadata + comment_count only, no bodies anywhere. */
export function redactCommentBodies(body: unknown): unknown {
  return mapPlans(body, (plan) => mapStepComments(plan, commentMetadata));
}

const INNER_B64_RE =
  /^<untrusted-tester-comment encoding="base64">([^<]*)<\/untrusted-tester-comment>$/;
const STRICT_B64_RE =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

/** Decode one dashboard-wrapped base64 body to UTF-8; null when it cannot be. */
export function decodeWrappedBody(raw: string): string | null {
  const m = INNER_B64_RE.exec(raw.trim());
  if (!m || !STRICT_B64_RE.test(m[1])) return null;
  try {
    const bytes = Buffer.from(m[1], 'base64');
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

// Invisible / format characters: Cf (ZWSP, ZWJ, WJ, BOM, soft hyphen, bidi
// overrides, TAG characters U+E0000-E007F — the "ASCII smuggling" channel),
// variation selectors and every other default-ignorable, private-use (Co),
// unassigned (Cn) and lone surrogates (Cs).
const INVISIBLE_RE =
  /[\p{Cf}\p{Co}\p{Cn}\p{Cs}\p{Default_Ignorable_Code_Point}\p{Variation_Selector}]/gu;
const CONTROL_RE = /\p{Cc}/gu;
// U+2028/U+2029 survive JSON.stringify raw, i.e. as a real line break.
const LINE_SEP_RE = /[\p{Zl}\p{Zp}]/gu;
// The wrap tag's name, any case, with up to 3 non-alphanumeric separators
// ("-", "_", space, none, ...) between words and combining marks allowed
// after any letter. Run on the NFKD form so fullwidth/math/small-form
// spellings have folded to ASCII and accents are separate combining marks.
const spell = (w: string): string => Array.from(w, (ch) => `${ch}\\p{M}*`).join('');
const SEP = '[^\\p{L}\\p{N}]{0,3}';
const WRAP_NAME_RE = new RegExp(
  `${spell('untrusted')}${SEP}${spell('tester')}${SEP}${spell('comment')}`,
  'giu',
);
export const WRAP_NAME_TOKEN = '[wrap-tag]';

/**
 * NFKC-normalise — done as NFKD first (folds fullwidth/small-form/math
 * letters and brackets to ASCII, and splits accents and U+226E/U+226F into a
 * base character plus a combining mark) and NFC last. In between: map
 * line/paragraph separators to "\n", drop control characters except newline
 * and tab, drop invisible/format characters, neutralise the wrap tag's name,
 * and replace every "<" / ">" so no tag can form. The final NFC cannot
 * rebuild a bracket: "<" is already gone, so "\u2039" + U+0338 stays apart.
 */
export function sanitizeCommentText(text: string): string {
  return text
    .normalize('NFKD')
    .replace(LINE_SEP_RE, '\n')
    .replace(CONTROL_RE, (ch) => (ch === '\n' || ch === '\t' ? ch : ''))
    .replace(INVISIBLE_RE, '')
    .replace(WRAP_NAME_RE, WRAP_NAME_TOKEN)
    .replace(/[<\u226E]/g, '\u2039')
    .replace(/[>\u226F]/g, '\u203A')
    .normalize('NFC');
}

/**
 * Render one body as plain text inside the wrap, drawing from a shared
 * per-response character budget. Caps count code points of comment text; the
 * truncation mark is appended wherever a body was cut.
 */
export function renderCommentBody(raw: unknown, budget: Budget): string | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  if (budget.remaining <= 0) {
    budget.omitted += 1;
    return null;
  }
  const decoded = decodeWrappedBody(raw);
  const text = decoded === null ? UNDECODABLE_COMMENT : sanitizeCommentText(decoded);
  const limit = Math.min(COMMENT_BODY_CAP, budget.remaining);
  const chars = Array.from(text);
  budget.remaining -= Math.min(chars.length, limit);
  const kept = chars.slice(0, limit).join('');
  const out = chars.length > limit ? kept + TRUNCATION_MARK : kept;
  return `${WRAP_OPEN}${out}${WRAP_CLOSE}`;
}

/** Every comment in the body, in output (traversal) order. */
function collectComments(body: unknown): unknown[] {
  const all: unknown[] = [];
  mapPlans(body, (plan) =>
    mapStepComments(plan, (c) => {
      all.push(c);
      return {};
    }),
  );
  return all;
}

const tsMs = (c: unknown): number => {
  const ms = isObj(c) && typeof c.ts === 'string' ? Date.parse(c.ts) : NaN;
  return Number.isNaN(ms) ? -Infinity : ms;
};

/** Output indices newest-first: ts descending, later position first on a tie. */
function newestFirst(all: unknown[]): number[] {
  const ms = all.map(tsMs);
  return all.map((_, i) => i).sort((a, b) => ms[b] - ms[a] || b - a);
}

/** A stripped-shape comment: the dashboard says a body exists but sent none. */
const bodyWithheld = (c: unknown): boolean =>
  isObj(c) && c.has_body === true && typeof c.body !== 'string';

/**
 * Opt-in path: metadata + decoded, sanitised, capped plain-text bodies. The
 * shared budget is spent newest-first so a busy plan keeps its latest
 * comments; the output keeps the dashboard's order.
 */
export function renderCommentBodies(body: unknown): unknown {
  const budget: Budget = { remaining: COMMENT_TOTAL_CAP, omitted: 0 };
  const all = collectComments(body);
  const rendered: Array<string | null> = all.map(() => null);
  for (const i of newestFirst(all)) {
    const c = all[i];
    rendered[i] = renderCommentBody(isObj(c) ? c.body : undefined, budget);
  }
  let next = 0;
  const out = mapPlans(body, (plan) =>
    mapStepComments(plan, (c) => ({ ...commentMetadata(c), body: rendered[next++] })),
  );
  if (!isObj(out)) return out;
  return {
    ...out,
    ...(budget.omitted > 0 ? { comment_bodies_omitted: budget.omitted } : {}),
    ...(all.some(bodyWithheld) ? { comment_bodies_unavailable: BODIES_UNAVAILABLE } : {}),
  };
}

/** A raw (non-JSON) dashboard body is withheld when it carries the wrap tag. */
const withholdRawBody = (raw: string): string =>
  /untrusted-tester-comment/i.test(raw) ? WITHHELD_RAW : raw;

/**
 * Shape a successful dashboard status body per the ROK-1657 contract. A 2xx
 * body that did not parse as JSON is never returned as the result.
 */
export function shapeStatusBody(body: unknown, includeComments: boolean): unknown {
  if (typeof body === 'string') {
    return { ok: false, error: 'unparseable_dashboard_body', body: withholdRawBody(body) };
  }
  return includeComments ? renderCommentBodies(body) : redactCommentBodies(body);
}

/**
 * Shape a non-2xx dashboard body: comment bodies are redacted exactly as on
 * the default read, and a raw (non-JSON) body that carries the wrap tag is
 * withheld, so an error path can never leak an unsanitised wrap.
 */
export function shapeErrorBody(body: unknown): unknown {
  if (typeof body === 'string') return withholdRawBody(body);
  return redactCommentBodies(body);
}
