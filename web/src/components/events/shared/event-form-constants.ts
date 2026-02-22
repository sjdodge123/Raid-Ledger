import type { SlotConfigDto } from '@raid-ledger/contract';

/** Duration presets in minutes */
export const DURATION_PRESETS = [
    { label: '1h', minutes: 60 },
    { label: '1.5h', minutes: 90 },
    { label: '2h', minutes: 120 },
    { label: '3h', minutes: 180 },
    { label: '4h', minutes: 240 },
] as const;

/** Default slot counts for MMO mode */
export const MMO_DEFAULTS: SlotConfigDto = { type: 'mmo', tank: 2, healer: 4, dps: 14, flex: 5, bench: 0 };

/** Default slot counts for generic mode */
export const GENERIC_DEFAULTS: SlotConfigDto = { type: 'generic', player: 10, bench: 5 };

/** Roster slot state shape used by both forms */
export interface SlotState {
    slotType: 'mmo' | 'generic';
    slotTank: number;
    slotHealer: number;
    slotDps: number;
    slotFlex: number;
    slotPlayer: number;
    slotBench: number;
    maxAttendees: string;
    durationMinutes: number;
    customDuration: boolean;
}

/**
 * Map a player cap to MMO composition slot counts.
 * Known breakpoints use hand-tuned values; unknown caps use proportional scaling.
 */
export function getCompositionForCap(cap: number): Pick<SlotState, 'slotTank' | 'slotHealer' | 'slotDps' | 'slotFlex' | 'slotBench'> {
    const known: Record<number, Pick<SlotState, 'slotTank' | 'slotHealer' | 'slotDps' | 'slotFlex' | 'slotBench'>> = {
        5:  { slotTank: 1, slotHealer: 1, slotDps: 3, slotFlex: 0, slotBench: 0 },
        8:  { slotTank: 1, slotHealer: 2, slotDps: 5, slotFlex: 0, slotBench: 0 },
        10: { slotTank: 2, slotHealer: 2, slotDps: 5, slotFlex: 1, slotBench: 0 },
        20: { slotTank: 2, slotHealer: 4, slotDps: 12, slotFlex: 2, slotBench: 0 },
        24: { slotTank: 2, slotHealer: 5, slotDps: 15, slotFlex: 2, slotBench: 0 },
        25: { slotTank: 2, slotHealer: 5, slotDps: 15, slotFlex: 3, slotBench: 0 },
        30: { slotTank: 2, slotHealer: 6, slotDps: 18, slotFlex: 4, slotBench: 0 },
        40: { slotTank: 4, slotHealer: 10, slotDps: 22, slotFlex: 4, slotBench: 0 },
    };
    if (known[cap]) return known[cap];
    const tank = Math.max(1, Math.round(cap * 0.1));
    const healer = Math.max(1, Math.round(cap * 0.2));
    const flex = Math.round(cap * 0.15);
    const dps = cap - tank - healer - flex;
    return { slotTank: tank, slotHealer: healer, slotDps: Math.max(1, dps), slotFlex: flex, slotBench: 0 };
}

/** Event type definition shape (subset used by applyEventTypeDefaults) */
interface EventTypeInfo {
    defaultDurationMinutes?: number | null;
    defaultPlayerCap?: number | null;
    requiresComposition?: boolean | null;
}

/**
 * Compute partial form state updates when event type changes.
 * Returns the slot/duration/capacity defaults for the given event type,
 * or reset-to-generic defaults for "custom" selection.
 */
export function applyEventTypeDefaults(
    eventType: EventTypeInfo | null,
): Partial<SlotState> {
    // "Custom" selection — reset to generic defaults
    if (!eventType) {
        return {
            durationMinutes: 120,
            customDuration: false,
            slotType: 'generic',
            slotTank: MMO_DEFAULTS.tank!,
            slotHealer: MMO_DEFAULTS.healer!,
            slotDps: MMO_DEFAULTS.dps!,
            slotFlex: MMO_DEFAULTS.flex!,
            slotPlayer: GENERIC_DEFAULTS.player!,
            slotBench: GENERIC_DEFAULTS.bench!,
            maxAttendees: '',
        };
    }

    const updates: Partial<SlotState> = {};

    if (eventType.defaultDurationMinutes) {
        updates.durationMinutes = eventType.defaultDurationMinutes;
        updates.customDuration = !DURATION_PRESETS.some((p) => p.minutes === eventType.defaultDurationMinutes);
    }

    if (eventType.defaultPlayerCap) {
        updates.maxAttendees = String(eventType.defaultPlayerCap);
        if (eventType.requiresComposition) {
            updates.slotType = 'mmo';
            Object.assign(updates, getCompositionForCap(eventType.defaultPlayerCap));
        } else {
            updates.slotType = 'generic';
            updates.slotPlayer = eventType.defaultPlayerCap;
            updates.slotBench = 0;
        }
    }

    if (eventType.requiresComposition && !eventType.defaultPlayerCap) {
        updates.slotType = 'mmo';
    } else if (!eventType.requiresComposition) {
        updates.slotType = 'generic';
    }

    return updates;
}
