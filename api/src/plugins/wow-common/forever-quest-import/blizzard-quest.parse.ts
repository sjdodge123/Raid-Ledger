/**
 * ROK-2143: pure URL builders and tolerant parsers for the Blizzard WoW:
 * Forever quest endpoints (shapes from the 2026-11-08 probe and Blizzard's
 * Game Data API docs: `quest/index` links its lists — `areas: { href }` —
 * and `quest/area/index` holds `areas[]`; an inline `areas[]` on
 * `quest/index` is accepted too. `quest/area/{id}` `quests[]`, `quest/{id}` with
 * `rewards.experience`, `rewards.money`, `rewards.items.items[].item`,
 * `rewards.reputations`). Nothing here throws on off-shape input: a missing
 * piece parses as null / empty. `requirements` is kept verbatim; the live run
 * (L5, 2026-11-09) saw only `classes[]`, `races[]`, `faction { name, type }`
 * and `quests { operator, conditions }` under it (no level) — the field
 * mapping lives in `blizzard-quest.requirements.ts`.
 */
import type {
  BlizzardQuestReputation,
  BlizzardQuestRewardItem,
} from '../../../drizzle/schema/dungeon-quest-blizzard';
import { extractPrerequisiteIds } from './blizzard-quest.prerequisites';

export {
  extractPrerequisiteIds,
  listPrerequisiteIds,
} from './blizzard-quest.prerequisites';

/** Only `static-forever-{region}` serves quest data (probe). */
export const FOREVER_QUEST_NAMESPACE_PREFIX = 'forever';
/** R8=B: item lookups (the `forever` item endpoint 404s) try classic 1.x. */
export const CLASSIC_ITEM_NAMESPACE_PREFIX = 'classic1x';
/** Nesting cap for the `requirements` walkers (circular-safe by depth). */
const MAX_WALK_DEPTH = 8;

function staticUrl(region: string, path: string, prefix: string): string {
  const r = region.toLowerCase();
  return `https://${r}.api.blizzard.com/data/wow/${path}?namespace=static-${prefix}-${r}&locale=en_US`;
}

export function buildQuestIndexUrl(region: string): string {
  return staticUrl(region, 'quest/index', FOREVER_QUEST_NAMESPACE_PREFIX);
}

/** The area list `quest/index` links to (`areas: { href }`). */
export function buildQuestAreaIndexUrl(region: string): string {
  return staticUrl(region, 'quest/area/index', FOREVER_QUEST_NAMESPACE_PREFIX);
}

export function buildQuestAreaUrl(region: string, areaId: number): string {
  return staticUrl(
    region,
    `quest/area/${areaId}`,
    FOREVER_QUEST_NAMESPACE_PREFIX,
  );
}

export function buildQuestUrl(region: string, questId: number): string {
  return staticUrl(region, `quest/${questId}`, FOREVER_QUEST_NAMESPACE_PREFIX);
}

export function buildClassicItemUrl(region: string, itemId: number): string {
  return staticUrl(region, `item/${itemId}`, CLASSIC_ITEM_NAMESPACE_PREFIX);
}

type JsonRecord = Record<string, unknown>;

const isRecord = (v: unknown): v is JsonRecord =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const asInt = (v: unknown): number | null =>
  typeof v === 'number' && Number.isInteger(v) ? v : null;
const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
/** A plain number, or `{ value }` (Blizzard wraps some amounts). */
const asAmount = (v: unknown): number | null =>
  asInt(v) ?? (isRecord(v) ? asInt(v.value) : null);

/** A string, or the `en_US` entry of a localized-name object. */
function asName(v: unknown): string | null {
  if (typeof v === 'string') return v;
  return isRecord(v) && typeof v.en_US === 'string' ? v.en_US : null;
}

/** `{ id, name }` from a Blizzard reference (`{ key, name, id }`). */
export interface BlizzardRef {
  id: number;
  name: string;
}

function toRef(v: unknown): BlizzardRef | null {
  if (!isRecord(v)) return null;
  const id = asInt(v.id);
  return id === null ? null : { id, name: asName(v.name) ?? '' };
}

const toRefs = (v: unknown): BlizzardRef[] =>
  asArray(v)
    .map(toRef)
    .filter((r): r is BlizzardRef => r !== null);

/**
 * `areas[]` (id + name) of `quest/area/index`, or of a `quest/index` that
 * lists them inline. The documented `quest/index` has `areas: { href }`
 * instead, which parses as [] (the crawl then reads `quest/area/index`).
 */
export function parseQuestIndexAreas(json: unknown): BlizzardRef[] {
  return isRecord(json) ? toRefs(json.areas) : [];
}

/** `quest/area/{id}` → its `quests[]` (id + title). */
export function parseQuestAreaQuests(json: unknown): BlizzardRef[] {
  return isRecord(json) ? toRefs(json.quests) : [];
}

export interface ParsedBlizzardQuest {
  questId: number;
  title: string;
  typeId: number | null;
  /** The area Blizzard files the quest under (may differ from the listing). */
  area: BlizzardRef | null;
  rewardXp: number | null;
  rewardMoneyCopper: number | null;
  rewardItems: BlizzardQuestRewardItem[];
  reputations: BlizzardQuestReputation[];
  /** `requirements`, verbatim; null when absent. */
  requirementsRaw: unknown;
  prerequisiteIds: number[];
  /** The whole response minus `_links`. */
  raw: JsonRecord;
}

/** `rewards.money` → copper: `value`, else the gold/silver/copper units. */
function parseMoney(v: unknown): number | null {
  const plain = asAmount(v);
  if (plain !== null || !isRecord(v) || !isRecord(v.units)) return plain;
  const { gold, silver, copper } = v.units;
  return (
    (asInt(gold) ?? 0) * 10000 +
    (asInt(silver) ?? 0) * 100 +
    (asInt(copper) ?? 0)
  );
}

/** `rewards.items.items[].item` (+ `choice_of[].item`), deduped by id. */
function parseRewardItems(v: unknown): BlizzardQuestRewardItem[] {
  const entries = isRecord(v)
    ? [...asArray(v.items), ...asArray(v.choice_of)]
    : asArray(v);
  const byId = new Map<number, BlizzardQuestRewardItem>();
  for (const entry of entries) {
    const ref = toRef(isRecord(entry) ? entry.item : null);
    if (ref && !byId.has(ref.id)) byId.set(ref.id, ref);
  }
  return [...byId.values()];
}

/** `rewards.reputations[]` → `{ factionId, name, value }`. */
function parseReputations(v: unknown): BlizzardQuestReputation[] {
  return asArray(v).flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const faction = toRef(entry.reward ?? entry.faction);
    const value = asInt(entry.value);
    if (!faction || value === null) return [];
    return [{ factionId: faction.id, name: faction.name, value }];
  });
}

/** One `quest/{id}` response; null when it has no integer id or no title. */
export function parseBlizzardQuest(json: unknown): ParsedBlizzardQuest | null {
  if (!isRecord(json)) return null;
  const questId = asInt(json.id);
  const title = asName(json.title);
  if (questId === null || title === null) return null;
  const rewards = isRecord(json.rewards) ? json.rewards : {};
  const requirementsRaw = json.requirements ?? null;
  return {
    questId,
    title,
    typeId: toRef(json.type)?.id ?? null,
    area: toRef(json.area),
    rewardXp: asAmount(rewards.experience),
    rewardMoneyCopper: parseMoney(rewards.money),
    rewardItems: parseRewardItems(rewards.items),
    reputations: parseReputations(rewards.reputations),
    requirementsRaw,
    prerequisiteIds: extractPrerequisiteIds(requirementsRaw, questId),
    raw: Object.fromEntries(
      Object.entries(json).filter(([key]) => key !== '_links'),
    ),
  };
}

const SKIPPED_KEYS = new Set(['key', '_links']);

function walkKeyPaths(
  v: unknown,
  path: string,
  out: Set<string>,
  depth: number,
): void {
  const children = Array.isArray(v)
    ? v.map((e): [string, unknown] => [`${path}[]`, e])
    : isRecord(v)
      ? Object.entries(v)
          .filter(([key]) => !SKIPPED_KEYS.has(key))
          .map(([key, c]): [string, unknown] => [
            path ? `${path}.${key}` : key,
            c,
          ])
      : [];
  if (children.length === 0 || depth >= MAX_WALK_DEPTH) {
    if (path)
      out.add(Array.isArray(v) && !path.endsWith('[]') ? `${path}[]` : path);
    return;
  }
  for (const [childPath, child] of children)
    walkKeyPaths(child, childPath, out, depth + 1);
}

/**
 * Distinct leaf key paths under a `requirements` object (`a.b`, arrays as
 * `a[]`, reference `key` hrefs skipped), sorted — the run report's
 * `requirementKeyPaths`. Union several quests' paths with a `Set`.
 */
export function collectRequirementKeyPaths(requirements: unknown): string[] {
  const out = new Set<string>();
  walkKeyPaths(requirements, '', out, 0);
  return [...out].sort();
}
