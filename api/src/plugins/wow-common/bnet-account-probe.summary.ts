/**
 * ROK-2129 (spec D7/D8): keys-only recorders for the Battle.net account
 * probe. Pure functions with an explicit allow-shape — their output is only
 * key-name arrays, integers and booleans (plus the token `scope`, filtered to
 * scope-name tokens). No token, code, character/realm name, slug or id value
 * can reach the result, so nothing personal is ever persisted.
 *
 * Unlike `summariseShape`/`sampleEntry` in the namespace probe, NO value is
 * copied — a user's own account is not a static game-data index.
 */
import type {
  BnetProbeAccountSummary,
  BnetProbeHrefShapes,
  BnetProbeTokenSummary,
} from '@raid-ledger/contract';

/** How a character href addresses the character. */
export type BnetProbeHrefShape = 'realmless' | 'realm' | 'none';

/** Request facts the token body itself does not carry. */
export interface BnetProbeTokenMeta {
  status: number;
  host: string;
  pkceAccepted: boolean;
}

const MAX_KEY_LENGTH = 64;
const CHARACTER_PATH = '/profile/wow/character/';
const SCOPE_TOKEN = /^[A-Za-z][A-Za-z0-9._-]{0,63}$/;
const MAX_SCOPE_TOKENS = 16;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function keysOf(v: Record<string, unknown>): string[] {
  return Object.keys(v).filter((k) => k.length <= MAX_KEY_LENGTH);
}

function sorted(set: Set<string>): string[] {
  return [...set].sort();
}

/**
 * Classify a character href: `/profile/wow/character/{name}` is
 * `realmless`, `/profile/wow/character/{realm}/{name}` is `realm`, anything
 * else (missing, unparseable, sub-resource) is `none`.
 */
export function hrefShape(href: unknown): BnetProbeHrefShape {
  if (typeof href !== 'string') return 'none';
  let path: string;
  try {
    path = new URL(href).pathname;
  } catch {
    return 'none';
  }
  if (!path.startsWith(CHARACTER_PATH)) return 'none';
  const segments = path.slice(CHARACTER_PATH.length).split('/').filter(Boolean);
  if (segments.length === 1) return 'realmless';
  return segments.length === 2 ? 'realm' : 'none';
}

function scopeNames(scope: unknown): string | null {
  if (typeof scope !== 'string') return null;
  const names = scope.split(/\s+/).filter((t) => SCOPE_TOKEN.test(t));
  return names.slice(0, MAX_SCOPE_TOKENS).join(' ');
}

function hasString(body: Record<string, unknown>, key: string): boolean {
  const v = body[key];
  return typeof v === 'string' && v.length > 0;
}

/**
 * Summarise an OAuth token response: key names, `expires_in`, `scope` names
 * and whether a refresh/id token was issued. Token VALUES are never copied.
 * Malformed bodies yield an empty summary, never a throw.
 */
export function summariseTokenResponse(
  body: unknown,
  meta: BnetProbeTokenMeta,
): BnetProbeTokenSummary {
  const rec = isRecord(body) ? body : {};
  const expires = rec.expires_in;
  return {
    status: meta.status,
    host: meta.host,
    keys: keysOf(rec).sort(),
    expiresIn: Number.isSafeInteger(expires) ? Number(expires) : null,
    refreshTokenIssued: hasString(rec, 'refresh_token'),
    idTokenIssued: hasString(rec, 'id_token'),
    scope: scopeNames(rec.scope),
    pkceAccepted: meta.pkceAccepted,
  };
}

interface CharacterTally {
  count: number;
  keys: Set<string>;
  frequency: Map<string, number>;
  nested: Map<string, Set<string>>;
  hrefShapes: BnetProbeHrefShapes;
}

function characterHref(c: Record<string, unknown>): unknown {
  const ref = isRecord(c.character) ? c.character : c.key;
  return isRecord(ref) ? ref.href : undefined;
}

function tallyCharacter(t: CharacterTally, c: Record<string, unknown>): void {
  t.count += 1;
  for (const k of keysOf(c)) {
    t.keys.add(k);
    t.frequency.set(k, (t.frequency.get(k) ?? 0) + 1);
    const v = c[k];
    if (!isRecord(v)) continue;
    const nested = t.nested.get(k) ?? new Set<string>();
    for (const nk of keysOf(v)) nested.add(nk);
    t.nested.set(k, nested);
  }
  t.hrefShapes[hrefShape(characterHref(c))] += 1;
}

function accountsOf(body: Record<string, unknown>): Record<string, unknown>[] {
  const accounts = body.wow_accounts;
  return Array.isArray(accounts) ? accounts.filter(isRecord) : [];
}

function charactersOf(
  account: Record<string, unknown>,
): Record<string, unknown>[] {
  const chars = account.characters;
  return Array.isArray(chars) ? chars.filter(isRecord) : [];
}

function newTally(): CharacterTally {
  return {
    count: 0,
    keys: new Set(),
    frequency: new Map(),
    nested: new Map(),
    hrefShapes: { realmless: 0, realm: 0, none: 0 },
  };
}

/** Map → plain record in key order; `fromEntries` defines own props only. */
function byKey<V, O>(map: Map<string, V>, fn: (v: V) => O): Record<string, O> {
  const keys = [...map.keys()].sort();
  return Object.fromEntries(
    keys.flatMap((k) => {
      const v = map.get(k);
      return v === undefined ? [] : [[k, fn(v)] as const];
    }),
  );
}

/**
 * Summarise a `/profile/user/wow` body as key unions and counts only (D8).
 * Non-object accounts/characters are skipped; a malformed body yields zero
 * counts, never a throw.
 */
export function summariseAccountSummary(
  body: unknown,
): BnetProbeAccountSummary {
  const rec = isRecord(body) ? body : {};
  const accounts = accountsOf(rec);
  const accountKeys = new Set<string>();
  const tally = newTally();
  for (const account of accounts) {
    for (const k of keysOf(account)) accountKeys.add(k);
    for (const c of charactersOf(account)) tallyCharacter(tally, c);
  }
  return {
    topLevelKeys: keysOf(rec).sort(),
    wowAccountCount: accounts.length,
    characterCount: tally.count,
    accountKeys: sorted(accountKeys),
    characterKeys: sorted(tally.keys),
    characterKeyFrequency: byKey(tally.frequency, (n) => n),
    nestedKeys: byKey(tally.nested, sorted),
    hrefShapes: tally.hrefShapes,
  };
}
