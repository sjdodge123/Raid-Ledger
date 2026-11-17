/**
 * ROK-2212 L14 — the cast of the `withSuggestedGroup` seed-guild half
 * (`demo-test-guild-suggested-groups.helpers.ts`) and its response shape.
 * Split out for the 300-line limit.
 */
import type { SEED_PLAN_FACTION } from './demo-test-guild-dungeon-plan.helpers';

export type SgRole = 'tank' | 'healer' | 'dps';
type Role = SgRole;

export const CLASS_OF: Record<Role, string> = {
  tank: 'Warrior',
  healer: 'Priest',
  dps: 'Rogue',
};

export type SgOwner = 'tank1' | 'tank2' | 'healer' | 'dps1' | 'dps2' | 'dps3';
export type SgSlot = SgOwner | 'dps1Alt';
export type SgUnclaimed = 'healer' | 'dps' | 'noRole';

interface ClaimedSpec {
  slot: SgSlot;
  owner: SgOwner;
  role: Role;
  char: string;
}

export const CLAIMED: readonly ClaimedSpec[] = [
  { slot: 'tank1', owner: 'tank1', role: 'tank', char: 'Sgtanka' },
  { slot: 'tank2', owner: 'tank2', role: 'tank', char: 'Sgtankb' },
  { slot: 'healer', owner: 'healer', role: 'healer', char: 'Sgheala' },
  { slot: 'dps1', owner: 'dps1', role: 'dps', char: 'Sgdpsa' },
  { slot: 'dps1Alt', owner: 'dps1', role: 'dps', char: 'Sgdpsalt' },
  { slot: 'dps2', owner: 'dps2', role: 'dps', char: 'Sgdpsb' },
  { slot: 'dps3', owner: 'dps3', role: 'dps', char: 'Sgdpsc' },
];

export const UNCLAIMED: readonly {
  slot: SgUnclaimed;
  role: Role | null;
  char: string;
}[] = [
  { slot: 'healer', role: 'healer', char: 'Sgfreeheal' },
  { slot: 'dps', role: 'dps', char: 'Sgfreedps' },
  { slot: 'noRole', role: null, char: 'Sgfreenorole' },
];

export interface SeededSgCharacter {
  userId: number;
  username: string;
  characterId: string;
  memberId: number;
  name: string;
  role: Role;
}

export interface SeededSgUnclaimed {
  memberId: number;
  /** The planner token / `SuggestedGroupMember.key` (`m<memberId>`). */
  key: string;
  name: string;
  role: Role | null;
}

/** The `suggestedGroup` field of the seed-guild response. */
export interface SeededSuggestedGroup {
  instanceId: number;
  instanceName: string;
  minimumLevel: number;
  maximumLevel: number;
  /** Every seeded character's level (inside the span). */
  level: number;
  guildFaction: typeof SEED_PLAN_FACTION;
  characters: Record<SgSlot, SeededSgCharacter>;
  unclaimed: Record<SgUnclaimed, SeededSgUnclaimed>;
  /** Hub Overview (the widget) and the planner tab (the "all lineups" section). */
  hubPath: string;
  plannerPath: string;
}
