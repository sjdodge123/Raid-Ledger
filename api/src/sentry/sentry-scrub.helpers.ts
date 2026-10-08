/**
 * ROK-1592 (plan L13): redact secrets from a Sentry event before it leaves.
 *
 * `instrument.ts` must load first in main.ts, so this file imports nothing.
 * It mutates the event in place and returns the same object (beforeSend's
 * other branches return `event` by identity).
 *
 * - Any key matching SECRET_KEY, at any depth, in `request`, `extra`,
 *   `contexts` and `breadcrumbs`, becomes REDACTED.
 * - Inside `request` only, the OAuth `code` and `state` params too. Elsewhere
 *   `code` is a Discord / Postgres error code that triage needs.
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
const MAX_DEPTH = 12;

export interface ScrubbableEvent {
  request?: unknown;
  extra?: unknown;
  contexts?: unknown;
  breadcrumbs?: unknown;
  message?: string;
  exception?: { values?: Array<{ value?: string }> };
}

export function scrubString(value: string): string {
  return value
    .replace(QUERY_SECRET, `$1$2${REDACTED}`)
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
  seen: WeakSet<object>;
}

function scrubArray(arr: unknown[], walk: Walk, depth: number): void {
  // Sentry's query_string may be `[name, value]` pairs.
  const [name] = arr;
  if (arr.length === 2 && typeof name === 'string') {
    if (isSecretKey(name, walk.inRequest)) arr[1] = REDACTED;
  }
  arr.forEach((v, i) => {
    arr[i] = scrubValue(v, walk, depth + 1);
  });
}

function scrubValue(value: unknown, walk: Walk, depth: number): unknown {
  if (typeof value === 'string') return scrubString(value);
  if (!value || typeof value !== 'object' || depth > MAX_DEPTH) return value;
  if (walk.seen.has(value)) return value;
  walk.seen.add(value);
  if (Array.isArray(value)) {
    scrubArray(value as unknown[], walk, depth);
    return value;
  }
  const obj = value as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    obj[key] = isSecretKey(key, walk.inRequest)
      ? REDACTED
      : scrubValue(obj[key], walk, depth + 1);
  }
  return obj;
}

export function scrubSecrets<T extends ScrubbableEvent>(event: T): T {
  const seen = new WeakSet<object>();
  scrubValue(event.request, { inRequest: true, seen }, 0);
  for (const part of [event.extra, event.contexts, event.breadcrumbs]) {
    scrubValue(part, { inRequest: false, seen }, 0);
  }
  for (const ex of event.exception?.values ?? []) {
    if (typeof ex.value === 'string') ex.value = scrubString(ex.value);
  }
  if (typeof event.message === 'string') {
    event.message = scrubString(event.message);
  }
  return event;
}
