/**
 * ROK-2352 §5 — the `lfg-grouping` extension point
 * (`EXTENSION_POINTS.LFG_GROUPING`), keyed by game slug.
 *
 * An active adapter splits one game's LFG into several groups, each named by
 * an opaque `group_key` the adapter mints (WoW: `dungeon:<id>` / `raid:<id>`).
 * Core never parses a key; it only asks the adapter. With no active adapter
 * every key folds to `''` (`api/src/lfg/lfg-grouping.helpers.ts`).
 *
 * `behaviourId` is the id the owner plugin declares this behaviour under in
 * `HUB_PLUGIN_MANIFESTS` — one adapter is registered once per game slug, so
 * the hub-ownership guard reads the declared id from here, not from the key.
 */
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { CreateSignupDto, SlotConfigDto } from '@raid-ledger/contract';
import type * as schema from '../../drizzle/schema';

/** The transaction handle core is holding its per-game advisory lock on. */
export type LfgGroupingTx = PostgresJsDatabase<typeof schema>;

/** The game an LFG grouping call is about. */
export interface LfgGroupingGameContext {
  gameId: number;
  gameSlug: string;
  /** Catalogue region (WoW); absent → the adapter's default. */
  region?: string;
}

/** Role counts a group needs (§3.4). */
export interface LfgRosterShape {
  tank: number;
  healer: number;
  dps: number;
}

/** One group a game offers, as the adapter describes it. */
export interface LfgGroupDescriptor {
  key: string;
  label: string;
  kind: 'dungeon' | 'raid' | 'any';
  size: number;
  rosterShape?: LfgRosterShape;
  levelRange?: [number, number];
}

/** Which hand a detail belongs to. */
export interface LfgHandDetailContext {
  intentId: number;
  userId: number;
  gameId: number;
}

/** A group about to lock in (§3.8). */
export interface LfgLockInContext {
  gameId: number;
  groupKey: string;
  memberIntentIds: number[];
  /** "Any dungeon" lock-in: the instance the creator picked. */
  chosenGroupKey?: string;
}

/** userId → the signup fields carried into the event (ROK-2320 `carryover`). */
export type LfgSignupCarryover = Map<number, CreateSignupDto>;

/** What a lock-in adds to the event it creates. */
export interface LfgLockInPatch {
  slotConfig?: SlotConfigDto;
  contentInstances?: Record<string, unknown>[];
  title?: string;
  carryover: LfgSignupCarryover;
}

/** One live group whose coverage core asks for (§3.4). */
export interface LfgCoverageGroup {
  key: string;
  rosterShape: LfgRosterShape;
  /** The group's live hands, one per distinct member. */
  intentIds: number[];
}

/** The adapter a plugin registers under `EXTENSION_POINTS.LFG_GROUPING`. */
export interface LfgGroupingAdapter {
  /** Declared behaviour id in the owner plugin's manifest. */
  readonly behaviourId: string;
  /** Every group the game offers (dungeons + raids), without `''`. */
  listGroups(ctx: LfgGroupingGameContext): Promise<LfgGroupDescriptor[]>;
  /** The group a key names, or null when the key is unknown (→ 400). */
  describeGroup(
    ctx: LfgGroupingGameContext,
    groupKey: string,
  ): Promise<LfgGroupDescriptor | null>;
  /**
   * Validate and store a hand's plugin detail inside core's transaction.
   * Throws `BadRequestException` on an invalid detail (rolls the hand back).
   */
  saveHandDetail(
    tx: LfgGroupingTx,
    ctx: LfgHandDetailContext,
    detail: unknown,
  ): Promise<void>;
  /** intentId → the stored detail, for the hands asked about. */
  readMemberDetails(ctx: {
    intentIds: number[];
  }): Promise<Map<number, Record<string, unknown>>>;
  /** Roster shape, instance, title and carryover for a locking-in group. */
  buildLockInPatch(
    tx: LfgGroupingTx,
    ctx: LfgLockInContext,
  ): Promise<LfgLockInPatch>;
  /** userId → {characterId?, preferredRoles?} for converted hands (poll exit). */
  buildCarryover(ctx: { intentIds: number[] }): Promise<LfgSignupCarryover>;
  /**
   * groupKey → how much of `rosterShape` the group's members fill (§3.4,
   * `LfgGroupListItemDto.coverage`). Optional: absent → no coverage on the wire.
   */
  readCoverage?(ctx: {
    groups: LfgCoverageGroup[];
  }): Promise<Map<string, LfgRosterShape>>;
  /**
   * §3.3 / Q8: give a NEW keyed hand raised without a detail (Discord) the
   * user's last detail on this game, inside core's transaction. No last
   * detail → nothing ("role not set"). Never overwrites a stored detail.
   */
  copyLastDetail?(tx: LfgGroupingTx, ctx: LfgHandDetailContext): Promise<void>;
}
