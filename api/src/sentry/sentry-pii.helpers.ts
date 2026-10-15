/**
 * ROK-1779: strip personal data from a Sentry event before it leaves.
 *
 * `instrument.ts` must load first in main.ts, so this file imports nothing
 * (the depth/WeakSet walk mirrors `sentry-scrub.helpers.ts` on purpose — the
 * two key sets evolve separately). Mutates in place and returns the event.
 *
 * - `event.user` keeps only its internal `id` (triage needs it).
 * - Any username / display name / email / IP / community-name key, at any
 *   depth in request, extra, contexts, breadcrumbs, tags and spans, becomes
 *   `[redacted]`.
 * - Every string loses e-mail addresses (`[email]`) and IPv4/IPv6 literals
 *   (`[ip]`). Usernames inside free text cannot be matched generically.
 */
export const PII_REDACTED = '[redacted]';

const PII_KEY =
  /(?:^|[._])(?:user_?name|display_?name|e-?mail|ip_?address|community_?name)$/i;
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const IPV6 =
  /(?<![\w:.])(?:(?:[0-9a-f]{1,4}:){7}[0-9a-f]{1,4}|(?:[0-9a-f]{1,4}:){1,7}:(?:[0-9a-f]{1,4}(?::[0-9a-f]{1,4}){0,6})?|::(?:ffff:)?[0-9a-f]{1,4}(?::[0-9a-f]{1,4}){0,6}(?:\.\d{1,3}){0,3})(?![\w:])/gi;
const IPV4 = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
const MAX_DEPTH = 12;

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
    .replace(EMAIL, '[email]')
    .replace(IPV6, '[ip]')
    .replace(IPV4, '[ip]');
}

function scrubPiiValue(
  value: unknown,
  seen: WeakSet<object>,
  depth: number,
): unknown {
  if (typeof value === 'string') return scrubPiiString(value);
  if (!value || typeof value !== 'object' || depth > MAX_DEPTH) return value;
  if (seen.has(value)) return value;
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((v: unknown, i) => {
      value[i] = scrubPiiValue(v, seen, depth + 1);
    });
    return value;
  }
  const obj = value as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    obj[key] = PII_KEY.test(key)
      ? PII_REDACTED
      : scrubPiiValue(obj[key], seen, depth + 1);
  }
  return obj;
}

/** Keep only `id` on the user object (internal numeric id, no PII). */
function reduceUser(user: object | undefined): void {
  if (!user) return;
  for (const key of Object.keys(user)) {
    if (key !== 'id') Reflect.deleteProperty(user, key);
  }
}

export function scrubPii<T extends PiiScrubbableEvent>(event: T): T {
  reduceUser(event.user);
  const seen = new WeakSet<object>();
  const parts = [event.request, event.spans, event.extra, event.contexts];
  for (const part of [...parts, event.breadcrumbs, event.tags]) {
    scrubPiiValue(part, seen, 0);
  }
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
