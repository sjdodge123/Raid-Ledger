/**
 * ROK-2103: static-namespace journal + class indexes probed per matched
 * Forever target, plus the shape-summariser dispatch for every endpoint whose
 * shape is not the default index summary. Pure — no NestJS imports (the CI
 * canary reaches this through `forever-namespace-probe.helpers`).
 */
import type { ForeverProbeEndpoint } from '@raid-ledger/contract';
import {
  isKeysOnlyEndpoint,
  summariseKeys,
  type ProbeTarget,
} from './forever-namespace-probe.forever';
import type { ProbeUrl, ShapeSummary } from './forever-namespace-probe.helpers';
import { isValuesEndpoint } from './forever-namespace-probe.quest-data';
import {
  flattenValues,
  type ValuesShapeSummary,
} from './forever-namespace-probe.values';
import {
  isDeepKeysEndpoint,
  summariseDeepKeysFor,
} from './forever-namespace-probe.profile-extra';

/** Static index endpoint → its `data/wow` path. */
export const STATIC_ENDPOINTS: readonly [ForeverProbeEndpoint, string][] = [
  ['journal-expansion', 'journal-expansion/index'],
  ['journal-instance', 'journal-instance/index'],
  ['playable-class', 'playable-class/index'],
];

/** The array key each static index lists its entries under. */
const LIST_KEY: Partial<Record<ForeverProbeEndpoint, string>> = {
  'journal-expansion': 'tiers',
  'journal-instance': 'instances',
  'playable-class': 'classes',
  // ROK-2143: the quest index lists link groups; names stay empty if so.
  'quest-index': 'categories',
};

/** Names kept per shape (public game data, evidence only). */
const MAX_NAMES = 200;
/** Longest name kept (matches the contract's per-name cap). */
const MAX_NAME_LENGTH = 120;

/** A shape summary that may also list public entry names. */
export type NamedShapeSummary = ShapeSummary & { names?: string[] };

/** Any custom shape: named, keys-only, deep-keys or values (ROK-2143). */
export type CustomShapeSummary = NamedShapeSummary &
  Partial<Pick<ValuesShapeSummary, 'values'>>;

/** The three static index URLs for one matched (prefix, region). */
export function buildStaticUrls(target: ProbeTarget): ProbeUrl[] {
  const { prefix, region } = target;
  const base = `https://${region}.api.blizzard.com/data/wow`;
  const q = `?namespace=static-${prefix}-${region}&locale=en_US`;
  return STATIC_ENDPOINTS.map(([endpoint, path]) => ({
    endpoint,
    url: `${base}/${path}${q}`,
  }));
}

/** An entry's display name: a string or a localized object's `en_US`. */
function entryName(entry: unknown): string | null {
  if (!entry || typeof entry !== 'object') return null;
  const raw: unknown = Reflect.get(entry, 'name');
  const name: unknown =
    raw && typeof raw === 'object' ? Reflect.get(raw, 'en_US') : raw;
  if (typeof name !== 'string') return null;
  const trimmed = name.trim();
  return trimmed ? trimmed.slice(0, MAX_NAME_LENGTH) : null;
}

/** The endpoint's list (its known key, else the first array), or []. */
function entryList(
  endpoint: ForeverProbeEndpoint,
  rec: Record<string, unknown>,
): unknown[] {
  const key = LIST_KEY[endpoint];
  const known = key === undefined ? undefined : rec[key];
  if (Array.isArray(known)) return known;
  const first = Object.values(rec).find((v) => Array.isArray(v));
  return Array.isArray(first) ? first : [];
}

/** Sorted top-level keys, entry count and up to 200 entry names — no ids/hrefs. */
export function summariseStaticShape(
  endpoint: ForeverProbeEndpoint,
  body: unknown,
): NamedShapeSummary {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { topLevelKeys: [], entryCount: 0, sample: [], names: [] };
  }
  const rec: Record<string, unknown> = Object.fromEntries(Object.entries(body));
  const list = entryList(endpoint, rec);
  const names: string[] = [];
  for (const entry of list) {
    if (names.length >= MAX_NAMES) break;
    const name = entryName(entry);
    if (name !== null) names.push(name);
  }
  const topLevelKeys = Object.keys(rec).sort();
  return { topLevelKeys, entryCount: list.length, sample: [], names };
}

/** True for a static index endpoint. */
function isStaticEndpoint(endpoint: ForeverProbeEndpoint): boolean {
  return LIST_KEY[endpoint] !== undefined;
}

/** True when the endpoint's shape is keys-only or a static named shape. */
export function hasCustomShape(endpoint: ForeverProbeEndpoint): boolean {
  return (
    isKeysOnlyEndpoint(endpoint) ||
    isStaticEndpoint(endpoint) ||
    isDeepKeysEndpoint(endpoint) ||
    isValuesEndpoint(endpoint)
  );
}

/** The keys-only, deep-keys (ROK-2108), values (ROK-2143) or static named shape for an endpoint {@link hasCustomShape} accepts. */
export function summariseCustomShape(
  endpoint: ForeverProbeEndpoint,
  body: unknown,
): CustomShapeSummary {
  if (isStaticEndpoint(endpoint)) return summariseStaticShape(endpoint, body);
  // ROK-2143: public static quest / item data records values.
  if (isValuesEndpoint(endpoint)) return flattenValues(body);
  // ROK-2108; profile-quests one level deeper (ROK-2126).
  if (isDeepKeysEndpoint(endpoint)) return summariseDeepKeysFor(endpoint, body);
  return summariseKeys(body);
}
