/**
 * ROK-1910 (epic ROK-1905 H4) — the WoW roster fact layer. Each
 * {@link WowFactSource} answers some fields for a batch of roster rows; the
 * pure precedence resolver (`fact-precedence.ts`) picks one {@link Fact} per
 * field. Widgets read `{ value, source, asOf }` and never pick a source.
 */
import type {
  AddonLockout,
  AddonQuests,
  AddonSnapshotGearItem,
  CharacterProfessionsDto,
  CharacterRole,
  HubFactSource,
} from '@raid-ledger/contract';

/** Value type of every field a source can answer. */
export interface WowFactValues {
  level: number;
  class: string;
  race: string;
  role: CharacterRole;
  ilvl: number;
  gear: AddonSnapshotGearItem[];
  professions: CharacterProfessionsDto;
  quests: AddonQuests;
  lockouts: AddonLockout[];
  lastOnline: Date;
  /**
   * ROK-1915 — the gear came from an export that reports enchants (addon
   * snapshot schema ≥ 2). False = an older export; its missing enchants are
   * unknown, never "missing".
   */
  enchantsReported: boolean;
}

/** A field a source can answer. */
export type WowFactField = keyof WowFactValues;

/** Every field, in a stable order. */
export const WOW_FACT_FIELDS: readonly WowFactField[] = [
  'level',
  'class',
  'race',
  'role',
  'ilvl',
  'gear',
  'professions',
  'quests',
  'lockouts',
  'lastOnline',
  'enchantsReported',
];

/** One fact: its value, where it came from, and how fresh it is. */
export interface Fact<T> {
  value: T;
  source: HubFactSource;
  /** Capture time of the value; null = unknown. */
  asOf: Date | null;
}

/** What one source knows about one roster row (absent = no value). */
export type WowFactCandidates = {
  [F in WowFactField]?: Fact<WowFactValues[F]>;
};

/** The resolved facts of one roster row; null = unknown. */
export type ResolvedWowFacts = {
  [F in WowFactField]: Fact<WowFactValues[F]> | null;
};

/** Key of one roster row in every source's result map. */
export type RosterKey = string;

/**
 * One roster row to resolve: a `guild_members` row, its linked character, or
 * both. `key` is opaque to the sources; they echo it back.
 */
export interface RosterCharRef {
  key: RosterKey;
  memberId: number | null;
  characterId: string | null;
}

/** A batched provider of facts. ONE query per `load` call. */
export interface WowFactSource {
  readonly id: HubFactSource;
  readonly fields: readonly WowFactField[];
  load(refs: RosterCharRef[]): Promise<Map<RosterKey, WowFactCandidates>>;
}

/** Most roster rows one resolve call accepts (LedgerLink `guild.members` cap). */
export const MAX_ROSTER_ROWS = 2000;
