/**
 * ROK-1926 (epic ROK-1905 W11/H18) — "Ready for next run": pure per-signup
 * checks (level, dungeon quests, lockout, item level) for one event. No DB,
 * no Nest. Missing data is `unknown`, NEVER `fail`; a check the event has no
 * requirement for is `na` and never changes `overall`.
 *
 * Input contract (lane B feeds it from DB rows):
 *
 *   buildRaidReadiness({
 *     event: { id, title, startTime: Date, contentInstances: unknown },
 *     questCount,  // buildQuestReadiness(...).quests.length
 *     signups: [{
 *       userId, characterId, name,
 *       facts,     // resolveFacts() row for the signup's ref; null = no character
 *       perQuest,  // buildQuestReadiness row's perQuest; null = no row
 *     }],
 *   }): EventRaidReadiness
 *
 * `contentInstances` is the raw `events.content_instances` jsonb; it is parsed
 * defensively (entries without a string `name` are ignored).
 */
import {
  foreverIlvlFloor,
  type EventQuestReadinessDto,
  type EventRaidReadiness,
  type HubFactFreshness,
  type ReadyCheckState,
} from '@raid-ledger/contract';
import type { Fact, ResolvedWowFacts } from './facts/wow-fact.types';
import {
  findBlockingSave,
  type ReadinessInstance,
} from './event-raid-readiness.lockouts';

export type { ReadinessInstance } from './event-raid-readiness.lockouts';

type Signup = EventRaidReadiness['signups'][number];
type Requirements = EventRaidReadiness['requirements'];
type PerQuest = EventQuestReadinessDto['signups'][number]['perQuest'][number];

/** The facts the checks read (a `ResolvedWowFacts` satisfies it). */
export type ReadinessFacts = Pick<
  ResolvedWowFacts,
  'level' | 'ilvl' | 'lockouts'
>;

/** One active signup of the event. */
export interface ReadinessSignupInput {
  userId: number;
  /** `characters.id`; null = the signup has no character. */
  characterId: string | null;
  name: string;
  /** Resolved facts for the signup's character; null = no character. */
  facts: ReadinessFacts | null;
  /** The signup's `buildQuestReadiness` row; null = no row. */
  perQuest: readonly Pick<PerQuest, 'state' | 'prereqsMet'>[] | null;
}

export interface RaidReadinessInput {
  event: {
    id: number;
    title: string;
    startTime: Date;
    /** Raw `events.content_instances` jsonb. */
    contentInstances: unknown;
  };
  /** Quests known for the event's instances (0 = quest check `na`). */
  questCount: number;
  signups: readonly ReadinessSignupInput[];
}

const MAX_RAID_NAMES = 20;
/** Contract cap; matches `MAX_READINESS_SIGNUPS`. */
const MAX_SIGNUPS = 100;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const finiteOrNull = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

function parseInstance(raw: unknown): ReadinessInstance | null {
  if (!isRecord(raw) || typeof raw.name !== 'string') return null;
  const category = raw.category;
  return {
    id: finiteOrNull(raw.id),
    name: raw.name,
    shortName: typeof raw.shortName === 'string' ? raw.shortName : null,
    minimumLevel: finiteOrNull(raw.minimumLevel),
    category: category === 'raid' || category === 'dungeon' ? category : null,
  };
}

/** Parse `events.content_instances` defensively; bad entries are dropped. */
export function parseContentInstances(raw: unknown): ReadinessInstance[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map(parseInstance)
    .filter((i): i is ReadinessInstance => i !== null);
}

/**
 * Lowest known `minimumLevel` (rec 4), its item-level floor (rec 8 — also on
 * dungeon nights), and the raid instances the "saved" check looks at.
 */
export function buildRequirements(
  instances: readonly ReadinessInstance[],
  questCount: number,
): Requirements {
  const mins = instances
    .map((i) => i.minimumLevel)
    .filter((m): m is number => m !== null);
  const minLevel = mins.length > 0 ? Math.min(...mins) : null;
  return {
    minLevel,
    ilvlFloor: minLevel === null ? null : foreverIlvlFloor(minLevel),
    raidNames: raidInstances(instances)
      .map((i) => i.name.slice(0, 200))
      .slice(0, MAX_RAID_NAMES),
    questCount: Math.max(0, questCount),
  };
}

const raidInstances = (instances: readonly ReadinessInstance[]) =>
  instances.filter((i) => i.category === 'raid');

const NA_CHECK = { state: 'na', value: null, source: null } as const;
const UNKNOWN_CHECK = { state: 'unknown', value: null, source: null } as const;

/** (a) Level vs the content's minimum level. */
export function evaluateLevel(
  fact: Fact<number> | null | undefined,
  minLevel: number | null,
): Signup['level'] {
  if (minLevel === null) return NA_CHECK;
  if (!fact) return UNKNOWN_CHECK;
  const state = fact.value >= minLevel ? 'pass' : 'fail';
  return { state, value: Math.round(fact.value), source: fact.source };
}

/** (d) Item level: the RAW average is compared, the rounded one displayed. */
export function evaluateIlvl(
  fact: Fact<number> | null | undefined,
  ilvlFloor: number | null,
): Signup['ilvl'] {
  if (ilvlFloor === null) return NA_CHECK;
  if (!fact) return UNKNOWN_CHECK;
  const state = fact.value >= ilvlFloor ? 'pass' : 'fail';
  return { state, value: Math.round(fact.value), source: fact.source };
}

const isReady = (q: Pick<PerQuest, 'state'>) =>
  q.state === 'done' || q.state === 'have';

function questState(
  perQuest: readonly Pick<PerQuest, 'state' | 'prereqsMet'>[],
): ReadyCheckState {
  // Pre-reqs only matter for a quest the character has not done or picked up.
  const open = perQuest.filter((q) => !isReady(q));
  if (open.some((q) => q.state === 'missing' || q.prereqsMet === false)) {
    return 'fail';
  }
  if (open.length > 0) return 'unknown';
  return 'pass';
}

/** (b) Dungeon quests and their pre-reqs (rec 5: missing quests fail). */
export function evaluateQuests(
  perQuest: ReadinessSignupInput['perQuest'],
  questCount: number,
): Signup['quests'] {
  if (questCount <= 0) return { state: 'na', ready: 0, total: 0 };
  if (perQuest === null)
    return { state: 'unknown', ready: 0, total: questCount };
  // No quest of the event is usable by this class/race.
  if (perQuest.length === 0) return { state: 'na', ready: 0, total: 0 };
  return {
    state: questState(perQuest),
    ready: perQuest.filter(isReady).length,
    total: perQuest.length,
  };
}

/** (c) Not saved to one of the event's raids when it starts (rec 6/7). */
export function evaluateSaved(
  fact: ReadinessFacts['lockouts'] | undefined,
  raids: readonly ReadinessInstance[],
  startTime: Date,
): Signup['saved'] {
  if (raids.length === 0) {
    return { state: 'na', instanceName: null, resetAt: null };
  }
  if (!fact) return { state: 'unknown', instanceName: null, resetAt: null };
  const hit = findBlockingSave(fact.value, raids, startTime.getTime());
  if (!hit) return { state: 'pass', instanceName: null, resetAt: null };
  return {
    state: 'fail',
    instanceName: hit.instance.name.slice(0, 200),
    resetAt: new Date(hit.lockout.resetAt * 1000).toISOString(),
  };
}

/** Any fail → fail; else any unknown → unknown; else pass (`na` ignored). */
export function overallState(
  states: readonly ReadyCheckState[],
): Signup['overall'] {
  if (states.includes('fail')) return 'fail';
  if (states.includes('unknown')) return 'unknown';
  return 'pass';
}

function evaluateSignup(
  s: ReadinessSignupInput,
  req: Requirements,
  raids: readonly ReadinessInstance[],
  startTime: Date,
): Signup {
  const level = evaluateLevel(s.facts?.level, req.minLevel);
  const quests = evaluateQuests(s.perQuest, req.questCount);
  const saved = evaluateSaved(s.facts?.lockouts, raids, startTime);
  const ilvl = evaluateIlvl(s.facts?.ilvl, req.ilvlFloor);
  const overall = overallState([
    level.state,
    quests.state,
    saved.state,
    ilvl.state,
  ]);
  const name = s.name.slice(0, 64);
  return {
    userId: s.userId,
    characterId: s.characterId,
    name,
    level,
    quests,
    saved,
    ilvl,
    overall,
  };
}

type AnyFact = Pick<Fact<unknown>, 'source' | 'asOf'>;

/** The facts that fed a non-`na` cell of one signup. */
function usedFacts(s: ReadinessSignupInput, row: Signup): AnyFact[] {
  const f = s.facts;
  if (!f) return [];
  const used: (AnyFact | null)[] = [
    row.level.state === 'na' ? null : f.level,
    row.saved.state === 'na' ? null : f.lockouts,
    row.ilvl.state === 'na' ? null : f.ilvl,
  ];
  return used.filter((x): x is AnyFact => x !== null);
}

/** The oldest fact that fed any cell; a dated fact beats an undated one. */
export function oldestFreshness(
  facts: readonly AnyFact[],
): HubFactFreshness | null {
  const first = facts[0];
  if (!first) return null;
  const dated = facts.filter((f) => f.asOf !== null);
  const oldest = dated.reduce<AnyFact | null>(
    (min, f) => (min?.asOf && f.asOf && min.asOf <= f.asOf ? min : f),
    null,
  );
  const pick = oldest ?? first;
  return { source: pick.source, asOf: pick.asOf?.toISOString() ?? null };
}

/** Build the whole "Ready for next run" payload for one event. */
export function buildRaidReadiness(
  input: RaidReadinessInput,
): EventRaidReadiness {
  const { event } = input;
  const instances = parseContentInstances(event.contentInstances);
  const requirements = buildRequirements(instances, input.questCount);
  const raids = raidInstances(instances);
  const rows = input.signups.slice(0, MAX_SIGNUPS).map((s) => ({
    s,
    row: evaluateSignup(s, requirements, raids, event.startTime),
  }));
  return {
    event: {
      id: event.id,
      title: event.title.slice(0, 200),
      startTime: event.startTime.toISOString(),
    },
    requirements,
    signups: rows.map((r) => r.row),
    freshness: oldestFreshness(rows.flatMap((r) => usedFacts(r.s, r.row))),
  };
}
