/**
 * ROK-2176: per-stat maths for comparing a boss-loot drop against the
 * viewer's equipped item(s).
 *
 * Source pick (spec L3): the parsed Wowhead `tooltip` wins on both sides (one
 * parser → identical keys, includes "Equip:" effects) unless it is a random-
 * enchant item; equipped Armory gear falls back to Blizzard `stats/armor/
 * weapon`; anything else has no stats ("stats not synced").
 */
import type { EquipmentItemDto, ItemTooltip } from '@raid-ledger/contract';

export type StatUnit = 'flat' | 'percent';

/** One comparable stat line. */
export interface StatLine { key: string; name: string; value: number; unit: StatUnit }

/** The numbers of one item (or a summed pair) that a comparison reads. */
export interface StatsView {
    stats: StatLine[];
    armor: number | null;
    dps: number | null;
}

/** loot − equipped for one key. Zero deltas are kept (the popup shows "="). */
export type StatDelta = StatLine;

export const ARMOR_KEY = 'ARMOR';
export const BONUS_ARMOR_KEY = 'BONUS_ARMOR';
export const DPS_KEY = 'DPS';

/** Keys left out of the phone top-3 ranking (spec Q2) — raw armor dwarfs stats. */
const UNRANKED_KEYS = new Set([ARMOR_KEY, BONUS_ARMOR_KEY, DPS_KEY]);

/** Anything a stats view can be read from: a loot DTO or an equipped item. */
export interface StatSource {
    tooltip?: ItemTooltip | null | undefined;
    stats?: EquipmentItemDto['stats'];
    armor?: number | undefined;
    weapon?: EquipmentItemDto['weapon'];
}

/** Canonical UPPER_SNAKE key from a display name (spec L4): "Fire Resistance" → FIRE_RESISTANCE. */
export function statKeyFromName(name: string): string {
    return name.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function round1(n: number): number {
    return Math.round(n * 10) / 10;
}

function fromTooltip(t: ItemTooltip): StatsView {
    return {
        stats: t.stats.map((s) => ({ key: s.key, name: s.name, value: s.value, unit: s.unit ?? 'flat' })),
        armor: t.armor,
        dps: t.weapon ? t.weapon.dps : null,
    };
}

function fromArmory(item: StatSource): StatsView | null {
    const stats = item.stats ?? [];
    if (stats.length === 0 && item.armor === undefined && !item.weapon) return null;
    return {
        stats: stats.map((s) => ({ key: statKeyFromName(s.name), name: s.name, value: s.value, unit: 'flat' })),
        armor: item.armor ?? null,
        dps: item.weapon ? item.weapon.dps : null,
    };
}

/** L3 source pick; `null` = no stats known for this item. */
export function itemStatsView(item: StatSource): StatsView | null {
    if (item.tooltip && !item.tooltip.randomEnchant) return fromTooltip(item.tooltip);
    return fromArmory(item);
}

function addStat(into: Map<string, StatLine>, s: StatLine): void {
    const prev = into.get(s.key);
    into.set(s.key, prev ? { ...prev, value: round1(prev.value + s.value) } : { ...s });
}

function sumNullable(values: (number | null)[]): number | null {
    const known = values.filter((v): v is number => v !== null);
    return known.length === 0 ? null : round1(known.reduce((a, b) => a + b, 0));
}

/**
 * Sums several equipped views (Two-Hand loot vs Main Hand + Off Hand). Stats
 * and armor add up; DPS is the first view's (the main hand's). Any unknown
 * view makes the sum unknown.
 */
export function sumViews(views: (StatsView | null)[]): StatsView | null {
    if (views.some((v) => v === null)) return null;
    const known = views.filter((v): v is StatsView => v !== null);
    if (known.length === 0) return null;
    const byKey = new Map<string, StatLine>();
    for (const v of known) for (const s of v.stats) addStat(byKey, s);
    return {
        stats: [...byKey.values()],
        armor: sumNullable(known.map((v) => v.armor)),
        dps: known[0]?.dps ?? null,
    };
}

function scalarDelta(key: string, name: string, loot: number | null, eq: number | null): StatDelta | null {
    if (loot === null && eq === null) return null;
    return { key, name, value: round1((loot ?? 0) - (eq ?? 0)), unit: 'flat' };
}

/**
 * Per-key loot − equipped. A key missing on the equipped side is a gain, a
 * key missing on the loot side a loss. `equipped === null` = an empty slot.
 * Order: loot keys, then equipped-only keys, then ARMOR, then DPS.
 */
export function diffItems(loot: StatsView, equipped: StatsView | null): StatDelta[] {
    const eqByKey = new Map<string, StatLine>();
    for (const s of equipped?.stats ?? []) addStat(eqByKey, s);
    const lootByKey = new Map<string, StatLine>();
    for (const s of loot.stats) addStat(lootByKey, s);
    const out: StatDelta[] = [];
    for (const s of lootByKey.values()) {
        out.push({ ...s, value: round1(s.value - (eqByKey.get(s.key)?.value ?? 0)) });
    }
    for (const s of eqByKey.values()) {
        if (!lootByKey.has(s.key)) out.push({ ...s, value: round1(-s.value) });
    }
    const armor = scalarDelta(ARMOR_KEY, 'Armor', loot.armor, equipped?.armor ?? null);
    const dps = scalarDelta(DPS_KEY, 'DPS', loot.dps, equipped?.dps ?? null);
    return [...out, ...(armor ? [armor] : []), ...(dps ? [dps] : [])];
}

export function nonZeroDeltas(deltas: StatDelta[]): StatDelta[] {
    return deltas.filter((d) => d.value !== 0);
}

/**
 * Phone rows (spec R2/Q2): the `n` largest |changes| among stat keys —
 * ARMOR, BONUS_ARMOR and DPS never rank — plus how many non-zero changes
 * were left out (those three included).
 */
export function topDeltas(deltas: StatDelta[], n: number): { shown: StatDelta[]; more: number } {
    const changed = nonZeroDeltas(deltas);
    const shown = changed
        .filter((d) => !UNRANKED_KEYS.has(d.key))
        .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
        .slice(0, n);
    return { shown, more: changed.length - shown.length };
}

export type DeltaTone = 'up' | 'down' | 'eq';

export function deltaTone(value: number): DeltaTone {
    if (value > 0) return 'up';
    return value < 0 ? 'down' : 'eq';
}

/** "▲ +12 Stamina", "▼ −1% Critical Strike", "= Spirit". */
export function formatDelta(d: StatDelta): string {
    if (d.value === 0) return `= ${d.name}`;
    const abs = Math.abs(d.value);
    const num = Number.isInteger(abs) ? String(abs) : abs.toFixed(1);
    const unit = d.unit === 'percent' ? '%' : '';
    return d.value > 0 ? `▲ +${num}${unit} ${d.name}` : `▼ −${num}${unit} ${d.name}`;
}
