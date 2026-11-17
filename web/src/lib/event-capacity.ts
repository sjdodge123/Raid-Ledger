/**
 * ROK-2229 — the capacity signups are allocated against, mirrored from the
 * api's `resolveEventCapacity` / `computeSlotCapacity`
 * (api/src/events/signups-signup.helpers.ts) so the event page and the hub
 * thread header show the same "/ M".
 */
import type { EventResponseDto, SlotConfigDto } from '@raid-ledger/contract';

/** The api's `MMO_SLOT_DEFAULTS` (non-bench roles) — NOT the create form's defaults. */
const MMO_SLOT_DEFAULTS = { tank: 2, healer: 4, dps: 14, flex: 5 } as const;

/** Total non-bench slots in a roster config; null for a generic roster without `player`. */
function slotCapacity(slot: SlotConfigDto): number | null {
    if (slot.type === 'mmo') {
        const d = MMO_SLOT_DEFAULTS;
        return (
            (slot.tank ?? d.tank) +
            (slot.healer ?? d.healer) +
            (slot.dps ?? d.dps) +
            (slot.flex ?? d.flex)
        );
    }
    return slot.player ?? null;
}

/**
 * Slot roster first, then `maxAttendees`; null = uncapped. 0 is a real
 * capacity (allocation treats it as always full), never "uncapped".
 */
export function resolveEventCapacity(
    event: Pick<EventResponseDto, 'slotConfig' | 'maxAttendees'>,
): number | null {
    const slot = event.slotConfig ?? null;
    if (slot !== null) return slotCapacity(slot);
    return event.maxAttendees ?? null;
}
