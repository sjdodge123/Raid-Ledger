/**
 * ROK-1592 (plan L13): redact secrets from a Sentry event before it leaves.
 *
 * `instrument.ts` must load first in main.ts, so this file imports nothing.
 * ROK-1779: never writes to the objects it is handed — each scrubbed field
 * is replaced by a scrubbed copy (cycle-safe, depth-bounded, never throws;
 * mirrors `sentry-pii.helpers.ts`). Returns the same event object
 * (beforeSend's other branches return `event` by identity).
 *
 * - Any key matching SECRET_KEY, at any depth, in `request`, `extra`,
 *   `contexts` and `breadcrumbs`, becomes REDACTED.
 * - Inside `request` and transaction `spans` only, the OAuth `code` and
 *   `state` params too (a span's description/data/attributes carry the
 *   request URL). Elsewhere `code` is a Discord / Postgres error code that
 *   triage needs.
 * - Every string (URLs, query strings, messages, exception values) loses its
 *   secret query params and JSON-ish `"…token": "…"` values.
 */
export const REDACTED = '[redacted]';

const SECRET_KEY =
  /token|secret|credential|authorization|code_verifier|password|cookie|api[-_]?key/i;
const REQUEST_ONLY_KEYS = new Set(['code', 'state']);
const QUERY_SECRET =
  /([?&#]|^)((?:code|state|[a-z_]*token|code_verifier|client_secret|password)=)[^&#\s"']*/gi;
const JSON_SECRET =
  /("(?:[a-z_]*token|code_verifier|client_secret|password|secret)"\s*:\s*")(?:[^"\\]|\\.)*"/gi;
// ROK-1750: a private poll's share token rides the PATH, not the query.
// ROK-1599: so does the ICS subscribe-link token (`/cal/u/<token>.ics`).
const PATH_SECRET =
  /(\/(?:scheduling-polls\/share|p\/poll|cal\/u)\/)[A-Za-z0-9_-]{16,}/g;
// ROK-1833: a Valheim Link ingest token anywhere in a string (header dump,
// pasted into free text, an issue-response body).
const VALHEIM_LINK_TOKEN = /rlvl_[A-Za-z0-9_-]{43}/g;
// ROK-1593: a Google calendar id (often an e-mail address) rides the PATH of
// every Calendar v3 call; `primary` names no one and stays for triage.
const CALENDAR_PATH =
  /(\/calendar\/v3\/calendars\/)(?!primary(?:[/?#\s"']|$))[^/?#\s"']+/g;
const MAX_DEPTH = 12;

export interface ScrubbableEvent {
  request?: unknown;
  /** Transaction events (beforeSendTransaction). */
  spans?: unknown;
  transaction?: string;
  extra?: unknown;
  contexts?: unknown;
  breadcrumbs?: unknown;
  message?: string;
  exception?: { values?: Array<{ value?: string }> };
}

export function scrubString(value: string): string {
  return value
    .replace(QUERY_SECRET, `$1$2${REDACTED}`)
    .replace(PATH_SECRET, `$1${REDACTED}`)
    .replace(CALENDAR_PATH, `$1${REDACTED}`)
    .replace(VALHEIM_LINK_TOKEN, REDACTED)
    .replace(JSON_SECRET, `$1${REDACTED}"`);
}

function isSecretKey(key: string, inRequest: boolean): boolean {
  return (
    SECRET_KEY.test(key) ||
    (inRequest && REQUEST_ONLY_KEYS.has(key.toLowerCase()))
  );
}

interface Walk {
  inRequest: boolean;
  /** The current path's ancestors — a repeat is a cycle. */
  ancestors: Set<object>;
}

const CIRCULAR = '[circular]';
const TRUNCATED = '[truncated]';
type ScrubField = 'request' | 'spans' | 'extra' | 'contexts' | 'breadcrumbs';
const FIELDS: ReadonlyArray<[ScrubField, boolean]> = [
  ['request', true],
  ['spans', true],
  ['extra', false],
  ['contexts', false],
  ['breadcrumbs', false],
];

function scrubArray(arr: readonly unknown[], walk: Walk, depth: number) {
  const out = arr.map((v: unknown) => scrubValue(v, walk, depth + 1));
  // Sentry's query_string may be `[name, value]` pairs.
  const [name] = arr;
  if (
    arr.length === 2 &&
    typeof name === 'string' &&
    isSecretKey(name, walk.inRequest)
  ) {
    out[1] = REDACTED;
  }
  return out;
}

/** Copy an object's own keys (plus an Error's name/message/stack), scrubbing each. */
function copyEntries(obj: object, walk: Walk, depth: number) {
  const out: Record<string, unknown> = {};
  if (obj instanceof Error) {
    out['name'] = obj.name;
    out['message'] = scrubString(obj.message);
    if (typeof obj.stack === 'string') out['stack'] = scrubString(obj.stack);
  }
  for (const key of Object.keys(obj)) {
    out[key] = isSecretKey(key, walk.inRequest)
      ? REDACTED
      : scrubValue(Reflect.get(obj, key), walk, depth + 1);
  }
  return out;
}

/**
 * Return a scrubbed COPY: request/extra/contexts can hold objects the app
 * still owns, so they are never written to — a frozen one would throw.
 * Cycles and depth are bounded.
 */
function scrubValue(value: unknown, walk: Walk, depth: number): unknown {
  if (typeof value === 'string') return scrubString(value);
  if (!value || typeof value !== 'object' || value instanceof Date) {
    return value;
  }
  if (walk.ancestors.has(value)) return CIRCULAR;
  if (depth > MAX_DEPTH) return TRUNCATED;
  walk.ancestors.add(value);
  try {
    return Array.isArray(value)
      ? scrubArray(value, walk, depth)
      : copyEntries(value, walk, depth);
  } finally {
    walk.ancestors.delete(value);
  }
}

/** Replace `target[key]` with its scrubbed copy; drop the field if that throws. */
function replaceField(
  target: ScrubbableEvent,
  key: ScrubField,
  inRequest: boolean,
): void {
  const value = target[key];
  if (value === undefined) return;
  try {
    target[key] = scrubValue(value, { inRequest, ancestors: new Set() }, 0);
  } catch {
    Reflect.deleteProperty(target, key);
  }
}

export function scrubSecrets<T extends ScrubbableEvent>(event: T): T {
  const target: ScrubbableEvent = event;
  for (const [field, inRequest] of FIELDS) {
    replaceField(target, field, inRequest);
  }
  for (const ex of event.exception?.values ?? []) {
    if (typeof ex.value === 'string') ex.value = scrubString(ex.value);
  }
  if (typeof event.message === 'string') {
    event.message = scrubString(event.message);
  }
  if (typeof event.transaction === 'string') {
    event.transaction = scrubString(event.transaction);
  }
  return event;
}
