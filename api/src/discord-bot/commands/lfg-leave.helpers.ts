/**
 * ROK-1660 — pure pieces of `/lfg-leave`: the autocomplete sentinels, the
 * own-hands-only choice list and the `All my LFGs` reply.
 *
 * The single-game copy (`You're out — …` / `You're not in the … group.`) and
 * the withdraw-if-present wrapper are shared with the board `I'm out` and the
 * `Leave · {game}` list buttons — they live in `listeners/lfg-leave.helpers`.
 */
import type { LfgGroupSummaryDto } from '@raid-ledger/contract';

/** Autocomplete value for `All my LFGs` — leaves every own hand at once. */
export const LFG_LEAVE_ALL_SENTINEL = 'all';
/** Autocomplete value shown when the caller has no hand anywhere. */
export const LFG_LEAVE_NONE_SENTINEL = 'none';

export const LFG_LEAVE_ALL_CHOICE: { name: string; value: string } = {
  name: 'All my LFGs',
  value: LFG_LEAVE_ALL_SENTINEL,
};

export const LFG_LEAVE_NONE_CHOICE: { name: string; value: string } = {
  name: "You're not in any LFG",
  value: LFG_LEAVE_NONE_SENTINEL,
};

/** Discord caps a response at 25 choices; `All my LFGs` takes one. */
export const LFG_LEAVE_MAX_GAME_CHOICES = 24;
/** Discord's limit on a choice's visible name. */
const CHOICE_NAME_CAP = 100;

/** Only the groups the caller has a hand in. */
export function ownGroups(groups: LfgGroupSummaryDto[]): LfgGroupSummaryDto[] {
  return groups.filter((g) => g.hasOwnIntent);
}

/**
 * The `/lfg-leave game:` autocomplete: `All my LFGs` first, then one choice
 * per OWN group whose name contains the typed text (case-insensitive).
 * No own groups → the single `You're not in any LFG` choice.
 *
 * @param groups - `LfgService.listGroups(userId)`; filtered to own here.
 * @param typed - What the caller has typed so far.
 */
export function buildLeaveChoices(
  groups: LfgGroupSummaryDto[],
  typed: string,
): Array<{ name: string; value: string }> {
  const own = ownGroups(groups);
  if (own.length === 0) return [LFG_LEAVE_NONE_CHOICE];
  const needle = typed.trim().toLowerCase();
  const games = own
    .filter((g) => g.gameName.toLowerCase().includes(needle))
    .slice(0, LFG_LEAVE_MAX_GAME_CHOICES)
    .map((g) => ({
      name: g.gameName.slice(0, CHOICE_NAME_CAP),
      value: String(g.gameId),
    }));
  return [LFG_LEAVE_ALL_CHOICE, ...games];
}

/**
 * The own group a typed value names: an autocomplete pick (`String(gameId)`)
 * or a free-typed exact (case-insensitive) title. Null when it is neither.
 */
export function matchOwnGroup(
  groups: LfgGroupSummaryDto[],
  typed: string,
): LfgGroupSummaryDto | null {
  const own = ownGroups(groups);
  const lower = typed.trim().toLowerCase();
  return (
    own.find((g) => String(g.gameId) === typed.trim()) ??
    own.find((g) => g.gameName.toLowerCase() === lower) ??
    null
  );
}

/** How many are still looking for `gameId` (0 once the group is gone). */
export function remainingCount(
  groups: LfgGroupSummaryDto[],
  gameId: number,
): number {
  return groups.find((g) => g.gameId === gameId)?.activeCount ?? 0;
}

/** `All my LFGs` with two or more groups left. */
export function buildLeftAllReply(gameNames: string[]): string {
  const list = gameNames.map((n) => `**${n}**`).join(', ');
  return `You're out of all ${gameNames.length} — ${list}.`;
}
