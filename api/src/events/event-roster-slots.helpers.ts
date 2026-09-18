/**
 * Default roster slots for events created by a "lock in" path rather than by
 * the `/events/new` form (ROK-1606).
 *
 * The form always submits a slot setup, so its events have a roster to place
 * signups into. Every programmatic create — LFG Lock-in (ROK-1573), a
 * scheduling-poll lock-in (ROK-1606) — builds its own `CreateEventDto`, and
 * without a `slotConfig` or `maxAttendees` `resolveGenericSlotRole` finds no
 * player slot: every signup, the creator's included, lands in the unassigned
 * pool instead of the roster (operator FAIL on both paths).
 *
 * One helper, so a third lock-in path cannot reintroduce the same gap.
 */
import type { CreateEventDto, SlotConfigDto } from '@raid-ledger/contract';

/** The `/events/new` form's generic default (`GENERIC_DEFAULTS`, 10 players). */
export const DEFAULT_ROSTER_SLOT_CONFIG: SlotConfigDto = {
  type: 'generic',
  player: 10,
};

/**
 * Ceiling on a cap-derived roster. `games.player_count.max` carries MMO-scale
 * numbers (and the occasional bad IGDB row), and a lock-in must not silently
 * mint hundreds of roster slots — above this the form's default is saner.
 */
const MAX_CAP_DERIVED_PLAYERS = 40;

/**
 * Review fix (P3): the game's own player cap, when it is usable.
 *
 * `resolveGameInfo` already resolves one (`resolvePlayerCap`: Co-Optimus
 * online max, else IGDB's `player_count.max`), so a 4-player co-op lock-in no
 * longer opens 10 slots. Null / zero / negative / absurd caps fall back.
 */
function capToPlayerSlots(playerCap: number | null | undefined): number {
  if (playerCap == null) return DEFAULT_ROSTER_SLOT_CONFIG.player as number;
  if (playerCap <= 0 || playerCap > MAX_CAP_DERIVED_PLAYERS) {
    return DEFAULT_ROSTER_SLOT_CONFIG.player as number;
  }
  return playerCap;
}

/**
 * Give a lock-in event a roster to sign into unless the caller named one.
 *
 * @param dto - The create body being built.
 * @param playerCap - The game's resolved player cap, when it is known. The
 *   default 10 is the fallback, never a shrink of an explicit `slotConfig`.
 * @returns `dto` untouched when it already carries `slotConfig` or
 *   `maxAttendees`; otherwise a copy with the default player slots.
 */
export function withDefaultRosterSlots(
  dto: CreateEventDto,
  playerCap?: number | null,
): CreateEventDto {
  if (dto.slotConfig || dto.maxAttendees) return dto;
  return {
    ...dto,
    slotConfig: { type: 'generic', player: capToPlayerSlots(playerCap) },
  };
}
