/**
 * ROK-1779: strip personal data from a Sentry event before it leaves.
 *
 * `instrument.ts` must load first in main.ts, so this file imports nothing
 * (the depth/WeakSet walk mirrors `sentry-scrub.helpers.ts` on purpose — the
 * two key sets evolve separately). Never writes to the objects it is handed:
 * each scrubbed field is replaced by a scrubbed copy; returns the event.
 *
 * - `event.user` keeps only its internal `id` (triage needs it).
 * - Any username / display name / email / IP / community-name key, at any
 *   depth in request, extra, contexts, breadcrumbs, tags and spans, becomes
 *   `[redacted]`.
 * - Every string loses e-mail addresses, percent-encoded too (`[email]`),
 *   and IPv4/IPv6 literals (`[ip]`). Usernames inside free text cannot be
 *   matched generically.
 */
export const PII_REDACTED = '[redacted]';

const PII_KEY =
  /(?:^|[._])(?:user_?name|display_?name|e-?mail|ip_?address|community_?name)$/i;
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
// Percent-encoded (`alice%40x.io`, double-encoded `%2540`, `+` as `%2B`) in
// URLs and query strings. The local part starts at a token boundary or right
// after a whole `%XX` escape, so `%3Dalice%40x.io` keeps its `%3D` and a
// form-encoded space (`find+alice`) is not swallowed.
const ENCODED_EMAIL =
  /(?<=^|[^A-Z0-9._%-]|%[0-9A-F]{2})[A-Z0-9._-]+(?:%(?:25)*2B[A-Z0-9._-]+)*%(?:25)*40[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const IPV6 =
  /(?<![\w:.])(?:(?:[0-9a-f]{1,4}:){7}[0-9a-f]{1,4}|(?:[0-9a-f]{1,4}:){1,7}:(?:[0-9a-f]{1,4}(?::[0-9a-f]{1,4}){0,6})?|::(?:ffff:)?[0-9a-f]{1,4}(?::[0-9a-f]{1,4}){0,6}(?:\.\d{1,3}){0,3})(?![\w:])/gi;
// Real octets only, and not a product-token version (`Chrome/141.0.0.0`,
// `Edg/129.0.0.0`): a match preceded by `Word/` at a token boundary is kept.
const IPV4 =
  /(?<![\w.]|(?:^|[\s(;,])[A-Za-z][\w.-]*\/)(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?!\.?\w)/g;
// camelCase compounds (`discordUsername`, `clientIpAddress`); case-sensitive
// so `hostname` / `voicemail` stay.
const PII_CAMEL_KEY =
  /[a-z\d](?:User_?[Nn]ame|Display_?[Nn]ame|E-?[Mm]ail|I[Pp]_?[Aa]ddress|Community_?[Nn]ame)$/;
const MAX_DEPTH = 12;

/** `contexts.browser.version` etc. hold bare `141.0.0.0` — not an address. */
const VERSION_KEY = /(?:^|[._-])[Vv]ersion$|[a-z\d]Version$/;

function isPiiKey(key: string): boolean {
  return PII_KEY.test(key) || PII_CAMEL_KEY.test(key);
}

export interface PiiScrubbableEvent {
  user?: object;
  request?: unknown;
  spans?: unknown;
  transaction?: string;
  extra?: unknown;
  contexts?: unknown;
  breadcrumbs?: unknown;
  tags?: unknown;
  message?: string;
  exception?: { values?: Array<{ value?: string }> };
}

export function scrubPiiString(value: string): string {
  return value
    .replace(ENCODED_EMAIL, '[email]')
    .replace(EMAIL, '[email]')
    .replace(IPV6, '[ip]')
    .replace(IPV4, '[ip]');
}

const CIRCULAR = '[circular]';
const TRUNCATED = '[truncated]';
type ScrubField =
  'request' | 'spans' | 'extra' | 'contexts' | 'breadcrumbs' | 'tags';
const EVENT_FIELDS: readonly ScrubField[] = [
  'request',
  'spans',
  'extra',
  'contexts',
  'breadcrumbs',
  'tags',
];

/** Copy an object's own keys (plus an Error's message/stack), scrubbing each. */
function copyEntries(
  obj: object,
  ancestors: Set<object>,
  depth: number,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (obj instanceof Error) {
    out['name'] = obj.name;
    out['message'] = scrubPiiString(obj.message);
    if (typeof obj.stack === 'string') out['stack'] = scrubPiiString(obj.stack);
  }
  for (const key of Object.keys(obj)) {
    const raw: unknown = Reflect.get(obj, key);
    if (VERSION_KEY.test(key) && typeof raw === 'string') out[key] = raw;
    else
      out[key] = isPiiKey(key)
        ? PII_REDACTED
        : scrubPiiValue(raw, ancestors, depth + 1);
  }
  return out;
}

/**
 * Return a scrubbed COPY: extras/contexts can hold objects the app still
 * owns, so they are never written to — a frozen one would throw. Cycles and
 * depth are bounded.
 */
function scrubPiiValue(
  value: unknown,
  ancestors: Set<object>,
  depth: number,
): unknown {
  if (typeof value === 'string') return scrubPiiString(value);
  if (!value || typeof value !== 'object' || value instanceof Date) {
    return value;
  }
  if (ancestors.has(value)) return CIRCULAR;
  if (depth > MAX_DEPTH) return TRUNCATED;
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((v: unknown) => scrubPiiValue(v, ancestors, depth + 1));
    }
    return copyEntries(value, ancestors, depth);
  } finally {
    ancestors.delete(value);
  }
}

/** Replace `target[key]` with its scrubbed copy; drop the field if that throws. */
function replaceField(target: PiiScrubbableEvent, key: ScrubField): void {
  const value = target[key];
  if (value === undefined) return;
  try {
    target[key] = scrubPiiValue(value, new Set<object>(), 0);
  } catch {
    Reflect.deleteProperty(target, key);
  }
}

/** Keep only `id` on the user object (internal numeric id, no PII). */
function reduceUser(user: object): object {
  const id: unknown = Reflect.get(user, 'id');
  return id === undefined ? {} : { id };
}

export function scrubPii<T extends PiiScrubbableEvent>(event: T): T {
  const target: PiiScrubbableEvent = event;
  if (target.user) target.user = reduceUser(target.user);
  for (const field of EVENT_FIELDS) replaceField(target, field);
  for (const ex of event.exception?.values ?? []) {
    if (typeof ex.value === 'string') ex.value = scrubPiiString(ex.value);
  }
  if (typeof event.message === 'string') {
    event.message = scrubPiiString(event.message);
  }
  if (typeof event.transaction === 'string') {
    event.transaction = scrubPiiString(event.transaction);
  }
  return event;
}
