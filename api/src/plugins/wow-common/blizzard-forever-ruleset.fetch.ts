/**
 * ROK-2100 — the realmless WoW: Forever profile call that reads ONLY the
 * character's `ruleset` object (no media / equipment). Never throws: the
 * caller is an upload's ruleset resolution, which falls through on any miss.
 */
import { buildCharacterParams } from './blizzard-character.helpers';
import { FOREVER_NAMESPACE_ALIAS } from './forever-namespace.resolver';

/**
 * `found` = a 200 body (its `ruleset`, possibly null); `absent` = 404/403
 * (below level 10, never logged out, hidden) — cacheable; `error` = 5xx,
 * abort or network — transient, not cacheable.
 */
export type ForeverRulesetFetchOutcome =
  | { kind: 'found'; ruleset: unknown }
  | { kind: 'absent' }
  | { kind: 'error' };

type FetchLogger = {
  debug: (msg: string) => void;
  warn: (msg: string) => void;
};

/** The profile body's `ruleset`, or null when the body is not an object. */
function readRuleset(body: unknown): unknown {
  if (typeof body !== 'object' || body === null) return null;
  return 'ruleset' in body ? (body.ruleset ?? null) : null;
}

/** GET the realmless Forever profile and classify the outcome. */
export async function fetchForeverRulesetRaw(
  name: string,
  region: string,
  token: string,
  signal: AbortSignal,
  logger: FetchLogger,
): Promise<ForeverRulesetFetchOutcome> {
  try {
    const p = buildCharacterParams(name, null, region, FOREVER_NAMESPACE_ALIAS);
    const url = `${p.baseUrl}/profile/wow/character/${p.characterPath}?namespace=${p.namespace}&locale=en_US`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal,
    });
    if (res.status === 404 || res.status === 403) {
      logger.debug(`Forever ruleset lookup: profile ${res.status}`);
      return { kind: 'absent' };
    }
    if (!res.ok) {
      logger.warn(`Forever ruleset lookup: profile API ${res.status}`);
      return { kind: 'error' };
    }
    return { kind: 'found', ruleset: readRuleset(await res.json()) };
  } catch (err) {
    const reason = err instanceof Error ? err.name : 'unknown';
    logger.warn(`Forever ruleset lookup failed: ${reason}`);
    return { kind: 'error' };
  }
}
