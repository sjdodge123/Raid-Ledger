/**
 * ROK-1910 — small pure helpers shared by the WoW fact sources.
 */
import { CharacterRoleSchema } from '@raid-ledger/contract';
import type {
  AddonCharSnapshotData,
  AddonSnapshotGearItem,
  CharacterRole,
  HubFactSource,
} from '@raid-ledger/contract';
import { CLASSIC_TALENT_TREE_ROLES } from '../blizzard.constants';
import type { Fact, RosterCharRef, RosterKey } from './wow-fact.types';

/** Shirt (4) and tabard (19) carry no item level that matters. */
const COSMETIC_SLOTS = new Set([4, 19]);

/** Classic talent tab order per class (the addon's `tree` 0-2). */
const CLASSIC_TREE_ORDER: Readonly<Record<string, readonly string[]>> = {
  druid: ['Balance', 'Feral Combat', 'Restoration'],
  warrior: ['Arms', 'Fury', 'Protection'],
  paladin: ['Holy', 'Protection', 'Retribution'],
  priest: ['Discipline', 'Holy', 'Shadow'],
  mage: ['Arcane', 'Fire', 'Frost'],
  warlock: ['Affliction', 'Demonology', 'Destruction'],
  rogue: ['Assassination', 'Combat', 'Subtlety'],
  hunter: ['Beast Mastery', 'Marksmanship', 'Survival'],
  shaman: ['Elemental', 'Enhancement', 'Restoration'],
};

/** Build a fact. */
export function fact<T>(
  value: T,
  source: HubFactSource,
  asOf: Date | null,
): Fact<T> {
  return { value, source, asOf };
}

/** Distinct non-null ids picked from the refs. */
export function distinctIds<K>(
  refs: RosterCharRef[],
  pick: (r: RosterCharRef) => K | null,
): K[] {
  const ids = new Set<K>();
  for (const r of refs) {
    const id = pick(r);
    if (id !== null) ids.add(id);
  }
  return [...ids];
}

/**
 * Fan per-id results back out to every roster key that points at the id.
 * @returns a map keyed by `RosterCharRef.key`.
 */
export function fanOut<K, V>(
  refs: RosterCharRef[],
  pick: (r: RosterCharRef) => K | null,
  byId: Map<K, V>,
): Map<RosterKey, V> {
  const out = new Map<RosterKey, V>();
  for (const r of refs) {
    const id = pick(r);
    const v = id === null ? undefined : byId.get(id);
    if (v !== undefined) out.set(r.key, v);
  }
  return out;
}

/** A role string narrowed to the contract enum, or null. */
export function toRole(raw: string | null): CharacterRole | null {
  const parsed = CharacterRoleSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** Mean item level of the worn, non-cosmetic gear; null when none. */
export function averageIlvl(gear: AddonSnapshotGearItem[]): number | null {
  const ilvls = gear.flatMap((g) =>
    COSMETIC_SLOTS.has(g.slot) || g.ilvl === undefined ? [] : [g.ilvl],
  );
  if (ilvls.length === 0) return null;
  return Math.round(ilvls.reduce((a, b) => a + b, 0) / ilvls.length);
}

/** Talent points spent per sub-tree 0-2. */
function pointsPerTree(talents: AddonCharSnapshotData['talents']): number[] {
  const points = [0, 0, 0];
  for (const n of talents.nodes) {
    if (n.tree !== undefined) points[n.tree] = (points[n.tree] ?? 0) + n.rank;
  }
  return points;
}

/**
 * Role hint from the deepest talent tree (Feral reads as dps).
 * @returns null when the class or tree is unknown or no points are spent.
 */
export function talentRoleHint(
  className: string | null,
  talents: AddonCharSnapshotData['talents'],
): CharacterRole | null {
  const key = className?.toLowerCase() ?? '';
  const order = CLASSIC_TREE_ORDER[key];
  if (!order) return null;
  const points = pointsPerTree(talents);
  const max = Math.max(...points);
  if (max <= 0) return null;
  const treeName = order[points.indexOf(max)];
  const classRoles = Object.entries(CLASSIC_TALENT_TREE_ROLES).find(
    ([name]) => name.toLowerCase() === key,
  )?.[1];
  if (treeName === undefined || classRoles === undefined) return null;
  return classRoles[treeName] ?? null;
}
