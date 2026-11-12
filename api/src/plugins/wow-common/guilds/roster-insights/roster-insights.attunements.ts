import {
  MAX_ROSTER_ATTUNEMENT_MEMBERS,
  type WowRosterAttunementDto,
  type WowRosterAttunementMemberDto,
  type WowRosterAttunementsDto,
} from '@raid-ledger/contract';
import type { AttunementDef } from '../../data/forever-attunements';
import type { EffectiveQuests } from '../../forever-quest-source.helpers';
import {
  appliesTo,
  evaluateAttunement,
  factionOfRace,
  isBelowLevel,
  noDataVerdict,
  prepareQuests,
  stepInLog,
  visibleDefs,
  type AttunementFactionSide,
  type AttunementVerdict,
  type PreparedQuests,
  type VisibleDef,
} from '../../attunement-evaluate';
import { WOW_FOREVER_GAME_SLUG } from '../../wow-forever-identity.helpers';
import type { InsightRow } from './roster-insights.types';

/** Re-exported: the faction rule moved beside the shared evaluator. */
export { factionOfRace };
export type { AttunementFactionSide };

/**
 * ROK-1927 (P2) — the members-only `attunements` section, computed purely
 * from the static dataset, the quest ids Blizzard confirmed (stored Forever
 * quest rows) and each roster main's effective quests. Only verdicts and step
 * labels leave this module — never a quest id or a completed list (AC10).
 *
 * Lead call 2026-11-12 (ruling B per id): a def whose FINAL required quest is
 * unconfirmed is hidden; an unconfirmed intermediate step is dropped from the
 * checklist, the step count and the in-progress test. No trackable def left
 * → the empty "not verified yet" payload. Completing the final quest alone =
 * attuned (ruling Q3).
 */

/**
 * Spec scope (review MINOR-1): the section is computed only for a Forever
 * `wow_guild` hub; any other hub omits the key.
 */
export function attunementsApply(
  hub: { kind: string; gameSlug: string | null } | null,
): boolean {
  return hub?.kind === 'wow_guild' && hub.gameSlug === WOW_FOREVER_GAME_SLUG;
}

/** One roster main as the attunement compute sees it. */
export interface AttunementMemberInput {
  rowKey: string;
  name: string;
  /** Null = unclaimed roster member (always `not_claimed`, no quest fetch). */
  characterId: string | null;
  cls: string | null;
  level: number | null;
  /**
   * Null = unknown: the `both` definitions are evaluated, and each faction
   * group gets ONE `no_data` result (never a guessed faction's verdict).
   */
  faction: AttunementFactionSide | null;
  /** Null = no addon quests slice and no Armory list. */
  quests: EffectiveQuests | null;
}

/**
 * The roster's faction: the side most rows with a known race belong to (a
 * guild is one faction). Fills in members whose race is unknown — typically
 * unclaimed roster members — so they still count as `no_data`. Tie → null.
 */
export function rosterFaction(
  rows: readonly InsightRow[],
): AttunementFactionSide | null {
  let horde = 0;
  let alliance = 0;
  for (const r of rows) {
    const side = factionOfRace(r.facts?.race?.value);
    if (side === 'horde') horde += 1;
    else if (side === 'alliance') alliance += 1;
  }
  if (horde === alliance) return null;
  return horde > alliance ? 'horde' : 'alliance';
}

/**
 * Roster row → compute input (rowKey: `characterId ?? 'm' + member id`).
 * Faction: race, then — claimed — the stored `characters.faction` column,
 * or — unclaimed only — the roster majority. A claimed character is never
 * given the roster's side (review MAJOR-2).
 */
export function toAttunementMember(
  row: InsightRow,
  quests: ReadonlyMap<string, EffectiveQuests>,
  rosterSide: AttunementFactionSide | null = null,
  storedSides: ReadonlyMap<string, AttunementFactionSide> = new Map(),
): AttunementMemberInput {
  const id = row.characterId;
  const fallback = id === null ? rosterSide : (storedSides.get(id) ?? null);
  return {
    rowKey: id ?? `m${row.memberId ?? row.name}`,
    name: row.name,
    characterId: id,
    cls: row.facts?.class?.value ?? null,
    level: row.facts?.level?.value ?? null,
    faction: factionOfRace(row.facts?.race?.value) ?? fallback,
    quests: id === null ? null : (quests.get(id) ?? null),
  };
}

function untrackedReason(def: AttunementDef): string | null {
  if (def.trackable) return null;
  if (def.steps.some((s) => s.kind === 'reputation'))
    return "Reputation isn't synced yet";
  return "Key items aren't tracked yet";
}

/** One member's verdict on one trackable, visible def. */
function verdict(
  v: VisibleDef,
  m: AttunementMemberInput,
  prepared: PreparedQuests | null,
): AttunementVerdict {
  if (m.characterId === null) return noDataVerdict('not_claimed');
  return evaluateAttunement(v, m.quests, prepared);
}

/** Unknown faction → a faction-specific def is no_data, never guessed. */
function unknownSideVerdict(m: AttunementMemberInput): AttunementVerdict {
  return noDataVerdict(
    m.characterId === null ? 'not_claimed' : 'no_quest_data',
  );
}

type ResultDto = WowRosterAttunementMemberDto['results'][number];

/**
 * The member's results: every def of its faction; with the faction unknown,
 * the `both` defs plus one no_data result per faction group (one per group
 * so the merged card counts the member once, not once per variant).
 */
function memberResults(
  m: AttunementMemberInput,
  tracked: readonly VisibleDef[],
): { results: ResultDto[]; logDated: boolean } {
  const prepared = prepareQuests(m.quests);
  const groups = new Set<string>();
  let logDated = false;
  const results = tracked.flatMap((v) => {
    const applies = appliesTo(v.def, m.faction);
    if (!applies && (m.faction !== null || groups.has(v.def.groupKey)))
      return [];
    groups.add(v.def.groupKey);
    const r = applies ? verdict(v, m, prepared) : unknownSideVerdict(m);
    if (r.state === 'in_progress' && stepInLog(v, m.quests)) logDated = true;
    const level = {
      belowLevel: isBelowLevel(v, m.level),
      requiredLevel: v.minLevel,
    };
    return [{ key: v.def.key, ...r, ...level }];
  });
  return { results, logDated };
}

/**
 * The member's data time: the completed list's, or — when a verdict leans on
 * the quest log — the OLDER of the list and the log (Codex P2), so a stale
 * log still shows the stale warning.
 */
function freshness(
  q: EffectiveQuests | null,
  logDated: boolean,
): Pick<WowRosterAttunementMemberDto, 'asOf' | 'source'> {
  if (q === null) return { asOf: null, source: null };
  const log = q.inProgressAsOf;
  if (logDated && log !== null && log < q.capturedAt)
    return { asOf: log.toISOString(), source: 'addon' };
  return { asOf: q.capturedAt.toISOString(), source: q.source };
}

function memberRow(
  m: AttunementMemberInput,
  tracked: readonly VisibleDef[],
): WowRosterAttunementMemberDto | null {
  const { results, logDated } = memberResults(m, tracked);
  if (results.length === 0) return null;
  return {
    rowKey: m.rowKey,
    name: m.name,
    characterId: m.characterId,
    cls: m.cls,
    level: m.level,
    ...freshness(m.quests, logDated),
    results,
  };
}

function tally(
  v: VisibleDef,
  members: readonly WowRosterAttunementMemberDto[],
): WowRosterAttunementDto {
  const counts = { done: 0, inProgress: 0, notStarted: 0, noData: 0 };
  for (const m of members) {
    const r = m.results.find((x) => x.key === v.def.key);
    if (r?.state === 'done') counts.done += 1;
    else if (r?.state === 'in_progress') counts.inProgress += 1;
    else if (r?.state === 'not_started') counts.notStarted += 1;
    else if (r?.state === 'no_data') counts.noData += 1;
  }
  const steps = v.def.trackable
    ? v.steps.map((s) => s.label)
    : v.def.steps.map((s) => s.label);
  const { key, groupKey, instance, faction, trackable } = v.def;
  return {
    key,
    groupKey,
    instance,
    faction,
    trackable,
    untrackedReason: untrackedReason(v.def),
    steps,
    counts,
  };
}

function oldestAsOf(
  members: readonly WowRosterAttunementMemberDto[],
): string | null {
  const times = members.flatMap((m) => (m.asOf ? [m.asOf] : []));
  return times.reduce<string | null>(
    (min, t) => (min === null || Date.parse(t) < Date.parse(min) ? t : min),
    null,
  );
}

/**
 * The section for a roster's mains. `confirmed` = quest ids with a stored
 * Blizzard Forever row. Untracked defs are listed (greyed, zero counts) only
 * beside at least one visible trackable def.
 */
export function computeAttunements(
  defs: readonly AttunementDef[],
  confirmed: ReadonlySet<number>,
  members: readonly AttunementMemberInput[],
): WowRosterAttunementsDto {
  const visible = visibleDefs(defs, confirmed);
  const tracked = visible.filter((v) => v.def.trackable);
  if (tracked.length === 0)
    return { attunements: [], members: [], oldestAsOf: null };
  const rows = members
    .slice(0, MAX_ROSTER_ATTUNEMENT_MEMBERS)
    .flatMap((m) => memberRow(m, tracked) ?? []);
  return {
    attunements: visible.map((v) => tally(v, rows)),
    members: rows,
    oldestAsOf: oldestAsOf(rows),
  };
}
