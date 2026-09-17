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
 * Give a lock-in event a roster to sign into unless the caller named one.
 *
 * @param dto - The create body being built.
 * @returns `dto` untouched when it already carries `slotConfig` or
 *   `maxAttendees`; otherwise a copy with the default player slots.
 */
export function withDefaultRosterSlots(dto: CreateEventDto): CreateEventDto {
  if (dto.slotConfig || dto.maxAttendees) return dto;
  return { ...dto, slotConfig: DEFAULT_ROSTER_SLOT_CONFIG };
}
