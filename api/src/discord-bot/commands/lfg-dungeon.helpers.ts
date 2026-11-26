/**
 * ROK-2352 §4.2 — the `dungeon` option on `/lfg` and `/lfg-leave`.
 *
 * Choices come from the game's ACTIVE `lfg-grouping` adapter (WoW: the
 * variant's dungeons AND raids). With no active adapter the game folds
 * (§3.7): the option has no choices and is ignored, so a non-WoW `/lfg`
 * writes exactly what it always did. "Any dungeon" is the `''` group; its
 * choice value is a sentinel because Discord refuses an empty choice value.
 *
 * Pure apart from the adapter call and one read of the caller's own hands.
 */
import { and, eq, gt } from 'drizzle-orm';
import { LFG_ANY_GROUP_KEY } from '@raid-ledger/contract';
import * as schema from '../../drizzle/schema';
import type { LfgDb } from '../../lfg/lfg-query.helpers';
import type {
  LfgGroupDescriptor,
  LfgGroupingAdapter,
  LfgGroupingGameContext,
} from '../../plugins/plugin-host/lfg-grouping.adapter';

/** The option's name on both commands. */
export const LFG_DUNGEON_OPTION = 'dungeon';
/** Sentinel choice value for the `''` group (Discord forbids `''`). */
export const LFG_ANY_DUNGEON_VALUE = 'any';
/** The `''` group's label in a WoW game. */
export const LFG_ANY_DUNGEON_LABEL = 'Any dungeon';
/** Discord's cap on autocomplete choices and on a choice's label. */
const MAX_CHOICES = 25;
const MAX_CHOICE_NAME = 100;

/** One autocomplete choice. */
export interface LfgDungeonChoice {
  name: string;
  value: string;
}

/** Where a `/lfg` write lands and how its roster is read. */
export interface LfgDungeonGroup {
  /** Sent as `groupKey`; `''` = Any dungeon / whole game. */
  groupKey: string;
  /** Roster scope: null = every hand (the game folds). */
  scope: string | null;
  /** The instance's label, or null for `''`. */
  label: string | null;
}

/** A descriptor's choice label: raids say so (the option lists both). */
function choiceName(group: LfgGroupDescriptor): string {
  const name = group.kind === 'raid' ? `${group.label} (raid)` : group.label;
  return name.slice(0, MAX_CHOICE_NAME);
}

/**
 * Autocomplete choices: Any dungeon first, then every group whose label
 * contains the typed text (case-insensitive), at most 25.
 *
 * @param groups - The adapter's catalogue (or the caller's held subset).
 * @param typed - The focused option's text.
 * @param includeAny - False when the caller holds no `''` hand to leave.
 */
export function buildDungeonChoices(
  groups: LfgGroupDescriptor[],
  typed: string,
  includeAny = true,
): LfgDungeonChoice[] {
  const needle = typed.trim().toLowerCase();
  const any = { name: LFG_ANY_DUNGEON_LABEL, value: LFG_ANY_DUNGEON_VALUE };
  const anyMatches = LFG_ANY_DUNGEON_LABEL.toLowerCase().includes(needle);
  const matches = groups
    .filter((g) => g.label.toLowerCase().includes(needle))
    .map((g) => ({ name: choiceName(g), value: g.key }));
  return [...(includeAny && anyMatches ? [any] : []), ...matches].slice(
    0,
    MAX_CHOICES,
  );
}

/**
 * The group a submitted `dungeon` value names: the Any sentinel or label →
 * `''`; an autocomplete pick (the key) or an exact label → that key.
 *
 * @returns The key, or null when the text names no group (never a guess).
 */
export function resolveDungeonPick(
  groups: LfgGroupDescriptor[],
  typed: string,
): string | null {
  const text = typed.trim();
  const lower = text.toLowerCase();
  if (text === '' || text === LFG_ANY_DUNGEON_VALUE) return LFG_ANY_GROUP_KEY;
  if (lower === LFG_ANY_DUNGEON_LABEL.toLowerCase()) return LFG_ANY_GROUP_KEY;
  const byKey = groups.find((g) => g.key === text);
  const byLabel = groups.find((g) => g.label.toLowerCase() === lower);
  return (byKey ?? byLabel)?.key ?? null;
}

/**
 * Resolve the `/lfg` `dungeon` option for one game.
 *
 * @param adapter - From `resolveLfgGrouping`; null = fold, option ignored.
 * @param ctx - The game.
 * @param typed - The option value, or null when omitted.
 * @returns The group, or null when an active adapter knows no such group.
 */
export async function resolveDungeonGroup(
  adapter: LfgGroupingAdapter | null,
  ctx: LfgGroupingGameContext,
  typed: string | null,
): Promise<LfgDungeonGroup | null> {
  if (adapter === null) {
    return { groupKey: LFG_ANY_GROUP_KEY, scope: null, label: null };
  }
  const any = { groupKey: LFG_ANY_GROUP_KEY, scope: '', label: null };
  if (typed === null || typed.trim() === '') return any;
  const groups = await adapter.listGroups(ctx);
  const key = resolveDungeonPick(groups, typed);
  if (key === null) return null;
  if (key === LFG_ANY_GROUP_KEY) return any;
  const label = groups.find((g) => g.key === key)?.label ?? null;
  return { groupKey: key, scope: key, label };
}

/** The reply when an active adapter knows no group by the typed name. */
export function buildUnknownDungeonReply(typed: string): string {
  const safe = typed.replace(/[*_`~|>\\]/g, '').slice(0, MAX_CHOICE_NAME);
  return `No dungeon or raid called **${safe}** for this game — pick one from the list.`;
}

/**
 * The group keys of the caller's live hands in one game (`/lfg-leave`).
 *
 * @param db - Drizzle handle.
 * @param userId - The caller.
 * @param gameId - The game picked in the `game` option.
 */
export async function listOwnHandKeys(
  db: LfgDb,
  userId: number,
  gameId: number,
): Promise<string[]> {
  const t = schema.lfgIntents;
  const rows = await db
    .selectDistinct({ groupKey: t.groupKey })
    .from(t)
    .where(
      and(
        eq(t.userId, userId),
        eq(t.gameId, gameId),
        eq(t.status, 'active'),
        gt(t.expiresAt, new Date()),
      ),
    );
  return rows.map((r) => r.groupKey);
}
