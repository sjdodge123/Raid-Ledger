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
export const MMO_DEFAULTS: SlotConfigDto = { type: 'mmo', tank: 2, healer: 4, dps: 14, flex: 0 };

/** Default slot counts for generic mode */
export const GENERIC_DEFAULTS: SlotConfigDto = { type: 'generic', player: 10 };

/** Roster slot state shape used by both forms */
export interface SlotState {
    slotType: 'mmo' | 'generic';
    slotTank: number;
    slotHealer: number;
    slotDps: number;
    slotFlex: number;
    slotPlayer: number;
    maxAttendees: string;
    durationMinutes: number;
    customDuration: boolean;
}

/**
 * Map a player cap to MMO composition slot counts.
 * Known breakpoints use hand-tuned values; unknown caps use proportional scaling.
 */
export function getCompositionForCap(cap: number): Pick<SlotState, 'slotTank' | 'slotHealer' | 'slotDps' | 'slotFlex'> {
    const known: Record<number, Pick<SlotState, 'slotTank' | 'slotHealer' | 'slotDps' | 'slotFlex'>> = {
        5:  { slotTank: 1, slotHealer: 1, slotDps: 3, slotFlex: 0 },
        8:  { slotTank: 1, slotHealer: 2, slotDps: 5, slotFlex: 0 },
        10: { slotTank: 2, slotHealer: 2, slotDps: 6, slotFlex: 0 },
        20: { slotTank: 2, slotHealer: 4, slotDps: 14, slotFlex: 0 },
        24: { slotTank: 2, slotHealer: 5, slotDps: 17, slotFlex: 0 },
        25: { slotTank: 2, slotHealer: 5, slotDps: 18, slotFlex: 0 },
        30: { slotTank: 2, slotHealer: 6, slotDps: 22, slotFlex: 0 },
        40: { slotTank: 4, slotHealer: 10, slotDps: 26, slotFlex: 0 },
    };
    if (known[cap]) return known[cap];
    return computeProportionalSlots(cap);
}

function computeProportionalSlots(cap: number): Pick<SlotState, 'slotTank' | 'slotHealer' | 'slotDps' | 'slotFlex'> {
    const tank = Math.max(1, Math.round(cap * 0.1));
    const healer = Math.max(1, Math.round(cap * 0.2));
    const dps = cap - tank - healer;
    return { slotTank: tank, slotHealer: healer, slotDps: Math.max(1, dps), slotFlex: 0 };
}

/** Event type definition shape (subset used by applyEventTypeDefaults) */
interface EventTypeInfo {
    defaultDurationMinutes?: number | null;
    defaultPlayerCap?: number | null;
    requiresComposition?: boolean | null;
}

function applyDurationDefaults(eventType: EventTypeInfo, updates: Partial<SlotState>) {
    if (eventType.defaultDurationMinutes) {
        updates.durationMinutes = eventType.defaultDurationMinutes;
        updates.customDuration = !DURATION_PRESETS.some((p) => p.minutes === eventType.defaultDurationMinutes);
    }
}

function applyCapDefaults(eventType: EventTypeInfo, updates: Partial<SlotState>) {
    if (!eventType.defaultPlayerCap) return;
    updates.maxAttendees = String(eventType.defaultPlayerCap);
    if (eventType.requiresComposition) {
        updates.slotType = 'mmo';
        Object.assign(updates, getCompositionForCap(eventType.defaultPlayerCap));
    } else {
        updates.slotType = 'generic';
        updates.slotPlayer = eventType.defaultPlayerCap;
    }
}

function getResetDefaults(): Partial<SlotState> {
    return {
        durationMinutes: 120, customDuration: false, slotType: 'generic',
        slotTank: MMO_DEFAULTS.tank!, slotHealer: MMO_DEFAULTS.healer!,
        slotDps: MMO_DEFAULTS.dps!, slotFlex: 0,
        slotPlayer: GENERIC_DEFAULTS.player!, maxAttendees: '',
    };
}

/**
 * Compute partial form state updates when event type changes.
 */
export function applyEventTypeDefaults(eventType: EventTypeInfo | null): Partial<SlotState> {
    if (!eventType) return getResetDefaults();

    const updates: Partial<SlotState> = {};
    applyDurationDefaults(eventType, updates);
    applyCapDefaults(eventType, updates);

    if (eventType.requiresComposition && !eventType.defaultPlayerCap) {
        updates.slotType = 'mmo';
    } else if (!eventType.requiresComposition) {
        updates.slotType = 'generic';
    }

    return updates;
}
