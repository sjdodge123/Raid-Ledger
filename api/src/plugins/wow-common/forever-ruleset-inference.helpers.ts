import type { WowForeverRuleset } from '@raid-ledger/contract';

/**
 * ROK-2100 — pure ruleset inference for WoW: Forever companion uploads that
 * carry no ruleset. Two sources, both tolerant and never throwing:
 * the realm's own name ("CAMWOW US2 Realm 9 RP PvP") and Blizzard's profile
 * `ruleset` object (shape unrecorded — spec F2). No match is `null`, never a
 * guess (spec F1): the caller then asks the member.
 */

const RP_WORDS: ReadonlySet<string> = new Set([
  'rp',
  'roleplay',
  'roleplaying',
]);
const HARDCORE_WORDS: ReadonlySet<string> = new Set(['hardcore', 'hc']);
const REALM_NORMAL_WORDS: ReadonlySet<string> = new Set(['normal', 'pve']);
const BLIZZARD_NORMAL_WORDS: ReadonlySet<string> = new Set([
  'normal',
  'pve',
  'standard',
]);
const UNMAPPED_PREFIX = 'forever ruleset unmapped: ';
const UNMAPPED_JSON_MAX = 200;

/** Unknown Blizzard shapes already warned about (once per process). */
const warnedShapes = new Set<string>();

/** Lower-cased whole words: split on anything not `a-z0-9`, drop empties. */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 0);
}

function hasAny(
  tokens: readonly string[],
  words: ReadonlySet<string>,
): boolean {
  return tokens.some((token) => words.has(token));
}

/**
 * Classify whole-word tokens. First match wins: rp + pvp anywhere (or the
 * fused `rppvp`) → rppvp; pvp → pvp; rp → roleplaying; hardcore → hardcore;
 * a normal word → normal; else null.
 */
function classifyTokens(
  tokens: readonly string[],
  normalWords: ReadonlySet<string>,
): WowForeverRuleset | null {
  const pvp = tokens.includes('pvp');
  const rp = hasAny(tokens, RP_WORDS);
  if (tokens.includes('rppvp') || (rp && pvp)) return 'rppvp';
  if (pvp) return 'pvp';
  if (rp) return 'roleplaying';
  if (hasAny(tokens, HARDCORE_WORDS)) return 'hardcore';
  if (hasAny(tokens, normalWords)) return 'normal';
  return null;
}

/**
 * Infer a Forever ruleset from the realm's display name, by whole
 * case-insensitive words only ("Sharpvpine" matches nothing).
 * Returns `null` for a missing/empty name or a name with no ruleset word.
 */
export function inferRulesetFromRealmName(
  realmName: string | undefined,
): WowForeverRuleset | null {
  if (realmName === undefined || realmName === '') return null;
  return classifyTokens(tokenize(realmName), REALM_NORMAL_WORDS);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A plain string, or the `en_US` value of a Blizzard localized object. */
function readText(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (isRecord(value) && typeof value['en_US'] === 'string') {
    return value['en_US'];
  }
  return null;
}

/** Candidate strings in read order: `type`, `name`, `slug` (or the string). */
function blizzardCandidates(raw: unknown): string[] {
  if (typeof raw === 'string') return [raw];
  if (!isRecord(raw)) return [];
  return [raw['type'], raw['name'], raw['slug']]
    .map(readText)
    .filter((text): text is string => text !== null);
}

function warnUnmappedOnce(raw: unknown, warn: (message: string) => void): void {
  const json = JSON.stringify(raw) ?? String(raw);
  const message = UNMAPPED_PREFIX + json.slice(0, UNMAPPED_JSON_MAX);
  if (warnedShapes.has(message)) return;
  warnedShapes.add(message);
  warn(message);
}

/**
 * Map Blizzard's character-profile `ruleset` value to a Forever ruleset.
 * Accepts `{ id, name }` (name may be localized), `{ type }`, `{ slug }` or a
 * bare string; the first candidate that maps wins. A present-but-unmappable
 * value returns `null` and calls `warn` once per distinct shape per process
 * (`forever ruleset unmapped: <JSON ≤200 chars>`). `null`/`undefined` (no
 * ruleset on the profile) returns `null` silently. Never throws.
 */
export function rulesetFromBlizzard(
  raw: unknown,
  warn: (message: string) => void,
): WowForeverRuleset | null {
  if (raw === null || raw === undefined) return null;
  for (const text of blizzardCandidates(raw)) {
    const ruleset = classifyTokens(tokenize(text), BLIZZARD_NORMAL_WORDS);
    if (ruleset !== null) return ruleset;
  }
  warnUnmappedOnce(raw, warn);
  return null;
}

/** Test seam: forget which unknown shapes were already warned about. */
export function resetUnmappedRulesetWarnings(): void {
  warnedShapes.clear();
}
