/**
 * ROK-2108: keys-only evidence for the realmless Forever character's untouched
 * sub-resources, the realmless guild summary and the first ruleset's detail —
 * probed after a namespace match. Records HTTP status, top-level keys and the
 * first element's keys (+ length) of each top-level array; never values.
 * Pure — no NestJS imports (the CI canary reaches this through the helpers).
 */
import type { ForeverProbeEndpoint } from '@raid-ledger/contract';
import {
  encodePath,
  probeQuery,
  profileRoot,
  type ProbeTarget,
} from './forever-namespace-probe.forever';
import type { ProbeUrl, ShapeSummary } from './forever-namespace-probe.helpers';

/** Profile sub-resource endpoint → its path under the character root. */
export const PROFILE_EXTRA_ENDPOINTS: readonly [
  ForeverProbeEndpoint,
  string,
][] = [
  ['profile-specializations', 'specializations'],
  ['profile-encounters-raids', 'encounters/raids'],
  ['profile-encounters-dungeons', 'encounters/dungeons'],
  ['profile-reputations', 'reputations'],
  ['profile-achievements', 'achievements'],
  ['profile-statistics', 'statistics'],
  ['profile-quests-completed', 'quests/completed'],
];

/**
 * ROK-2126: endpoints recorded one level deeper — the in-progress quest log,
 * whose entries carry the quest ref + objectives under each array element.
 */
const NESTED_DEEP_KEYS_ENDPOINTS: ReadonlySet<ForeverProbeEndpoint> = new Set([
  'profile-quests',
]);

/** Every endpoint whose shape is keys + first-element keys. */
const DEEP_KEYS_ENDPOINTS: ReadonlySet<ForeverProbeEndpoint> = new Set([
  ...PROFILE_EXTRA_ENDPOINTS.map(([endpoint]) => endpoint),
  'guild-summary',
  'ruleset-detail',
  ...NESTED_DEEP_KEYS_ENDPOINTS,
]);

/** A ruleset entry id safe to put in a path. */
const RULESET_ID_RE = /^[a-z0-9-]{1,64}$/i;

/** Keys-only shape plus, per top-level array, its first element's keys + length. */
export type DeepKeysShapeSummary = ShapeSummary & {
  arrayKeys: Record<string, string[]>;
  arrayLengths: Record<string, number>;
};

/** The seven extra profile sub-resource URLs (profile namespace). */
export function buildProfileExtraUrls(
  characterPath: string,
  target: ProbeTarget,
): ProbeUrl[] {
  const { prefix, region } = target;
  const root = profileRoot(characterPath, region);
  const q = probeQuery('profile', prefix, region);
  return PROFILE_EXTRA_ENDPOINTS.map(([endpoint, sub]) => ({
    endpoint,
    url: `${root}/${sub}${q}`,
  }));
}

/** Realmless guild summary `data/wow/guild/<slug>` (profile namespace). */
export function buildGuildSummaryUrl(
  guildPath: string,
  target: ProbeTarget,
): ProbeUrl {
  const { prefix, region } = target;
  const slug = encodePath(guildPath);
  const base = `https://${region}.api.blizzard.com/data/wow/guild`;
  return {
    endpoint: 'guild-summary',
    url: `${base}/${slug}${probeQuery('profile', prefix, region)}`,
  };
}

/** The first sampled ruleset entry's id, or null when absent / unsafe. */
export function firstRulesetId(shape: ShapeSummary | undefined): string | null {
  const id: unknown = shape?.sample[0]?.['id'];
  const text =
    typeof id === 'number' && Number.isInteger(id)
      ? String(id)
      : typeof id === 'string'
        ? id
        : null;
  return text !== null && RULESET_ID_RE.test(text) ? text : null;
}

/** The dynamic `ruleset/<id>` detail URL. */
export function buildRulesetDetailUrl(
  id: string,
  target: ProbeTarget,
): ProbeUrl {
  const { prefix, region } = target;
  const base = `https://${region}.api.blizzard.com/data/wow`;
  return {
    endpoint: 'ruleset-detail',
    url: `${base}/ruleset/${encodeURIComponent(id)}${probeQuery('dynamic', prefix, region)}`,
  };
}

/** Guild summary (if a guild is set) + first ruleset detail (if the index had one). */
export function buildMatchExtraUrls(
  target: ProbeTarget,
  guildPath: string | null,
  shapes: Readonly<Record<string, ShapeSummary>>,
): ProbeUrl[] {
  const out: ProbeUrl[] = [];
  if (guildPath) out.push(buildGuildSummaryUrl(guildPath, target));
  const id = firstRulesetId(
    shapes[`${target.prefix}:${target.region}:ruleset`],
  );
  if (id !== null) out.push(buildRulesetDetailUrl(id, target));
  return out;
}

/** True for an endpoint summarised by {@link summariseDeepKeys}. */
export function isDeepKeysEndpoint(endpoint: ForeverProbeEndpoint): boolean {
  return DEEP_KEYS_ENDPOINTS.has(endpoint);
}

/** True for a non-null, non-array object. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Keys of a plain object, else []. */
function objectKeys(value: unknown): string[] {
  return isPlainObject(value) ? Object.keys(value) : [];
}

/** Top-level keys + each top-level array's first-element keys and length — no values. */
export function summariseDeepKeys(body: unknown): DeepKeysShapeSummary {
  const topLevelKeys = objectKeys(body);
  const arrayKeys: Record<string, string[]> = {};
  const arrayLengths: Record<string, number> = {};
  if (topLevelKeys.length > 0 && body && typeof body === 'object') {
    for (const [key, value] of Object.entries(body)) {
      if (!Array.isArray(value)) continue;
      const first: unknown = value[0];
      arrayKeys[key] = objectKeys(first);
      arrayLengths[key] = value.length;
    }
  }
  return { topLevelKeys, entryCount: 0, sample: [], arrayKeys, arrayLengths };
}

/**
 * Fold one array's first element one level deeper into `shape`, under
 * `<arrayKey>[0].<key>`: a nested array adds its first element's keys + its
 * length; a nested plain object adds its keys (no length). Never values.
 */
function addNestedKeys(
  shape: DeepKeysShapeSummary,
  arrayKey: string,
  first: unknown,
): void {
  if (!isPlainObject(first)) return;
  for (const [key, value] of Object.entries(first)) {
    const path = `${arrayKey}[0].${key}`;
    if (Array.isArray(value)) {
      const nested: unknown = value[0];
      shape.arrayKeys[path] = objectKeys(nested);
      shape.arrayLengths[path] = value.length;
    } else if (isPlainObject(value)) {
      shape.arrayKeys[path] = Object.keys(value);
    }
  }
}

/**
 * ROK-2126: {@link summariseDeepKeys} plus one more level inside each top-level
 * array's first element (dotted `in_progress[0].objectives` keys), so the
 * in-progress quest log reveals its quest ref / objectives / progress fields.
 * Keys and lengths only — never a value.
 */
export function summariseNestedDeepKeys(body: unknown): DeepKeysShapeSummary {
  const shape = summariseDeepKeys(body);
  if (!isPlainObject(body)) return shape;
  for (const [key, value] of Object.entries(body)) {
    if (Array.isArray(value)) addNestedKeys(shape, key, value[0]);
  }
  return shape;
}

/**
 * ROK-1170: the guild summary's deep-keys shape plus `objectKeyTypes` — the
 * JS type of each top-level value and of each key one level inside a plain
 * object (`faction.type → string`, `created_timestamp → number`,
 * `member_count → number`). Types only, never a value.
 */
export type GuildSummaryShapeSummary = DeepKeysShapeSummary & {
  objectKeyTypes: Record<string, string>;
};

/** `typeof`, with `null` and `array` told apart from `object`. */
function typeName(value: unknown): string {
  if (value === null) return 'null';
  return Array.isArray(value) ? 'array' : typeof value;
}

/** {@link summariseDeepKeys} plus dotted key → type, two levels deep. */
export function summariseGuildSummaryKeys(
  body: unknown,
): GuildSummaryShapeSummary {
  const objectKeyTypes: Record<string, string> = {};
  const entries = isPlainObject(body) ? Object.entries(body) : [];
  for (const [key, value] of entries) {
    objectKeyTypes[key] = typeName(value);
    if (!isPlainObject(value)) continue;
    for (const [sub, inner] of Object.entries(value)) {
      objectKeyTypes[`${key}.${sub}`] = typeName(inner);
    }
  }
  return { ...summariseDeepKeys(body), objectKeyTypes };
}

/** The deep-keys summary for an endpoint {@link isDeepKeysEndpoint} accepts. */
export function summariseDeepKeysFor(
  endpoint: ForeverProbeEndpoint,
  body: unknown,
): DeepKeysShapeSummary &
  Partial<Pick<GuildSummaryShapeSummary, 'objectKeyTypes'>> {
  if (endpoint === 'guild-summary') return summariseGuildSummaryKeys(body);
  return NESTED_DEEP_KEYS_ENDPOINTS.has(endpoint)
    ? summariseNestedDeepKeys(body)
    : summariseDeepKeys(body);
}
