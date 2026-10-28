/**
 * ROK-1958 D-7 — display labels for raw `bg3-save` ids (race, class, subclass,
 * origin). Same rule as the contract display tables (ROK-1954): an override
 * map holds ONLY ids seen in a real save; anything else is humanised from the
 * raw id (`_` and camelCase split), never dropped.
 */
import type { Bg3Class } from '@raid-ledger/contract';

/** Seen ids whose humanised form reads wrong. */
const RACE_OVERRIDES: Readonly<Record<string, string>> = Object.freeze({
    HalfElf_High: 'High Half-Elf',
});

/** Seen subclass ids that carry a type suffix the game does not show. */
const SUBCLASS_OVERRIDES: Readonly<Record<string, string>> = Object.freeze({
    BerserkerPath: 'Berserker',
    NecromancySchool: 'Necromancy',
    Fiend: 'The Fiend',
});

const GENERIC_ORIGIN = 'Generic';
const SUMMON_SUFFIX = '_Summon';

function own(table: Readonly<Record<string, string>>, key: string): string | undefined {
    return Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined;
}

/** `GloomStalker` → "Gloom Stalker", `Elf_WoodElf` → "Elf Wood Elf". */
export function humaniseBg3Id(id: string): string {
    return id
        .replace(/_/g, ' ')
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Race label: the subrace segment reads first and a repeated word is dropped,
 * so `Elf_WoodElf` → "Wood Elf", `Tiefling_Asmodeus` → "Asmodeus Tiefling".
 */
export function bg3RaceLabel(race: string): string {
    const override = own(RACE_OVERRIDES, race);
    if (override !== undefined) return override;
    const words = race.split('_').reverse().flatMap((s) => humaniseBg3Id(s).split(' '));
    return [...new Set(words.filter((w) => w !== ''))].join(' ');
}

/** One class entry: "Ranger (Gloom Stalker)", or "Wizard" without a subclass. */
export function bg3ClassLabel(entry: Bg3Class): string {
    const main = humaniseBg3Id(entry.main);
    if (entry.sub === null) return main;
    return `${main} (${own(SUBCLASS_OVERRIDES, entry.sub) ?? humaniseBg3Id(entry.sub)})`;
}

/** Every class entry joined: "Ranger (Gloom Stalker) + Rogue (Thief)". */
export function bg3ClassesLabel(classes: readonly Bg3Class[]): string {
    return classes.map(bg3ClassLabel).join(' + ');
}

/** `DogFamiliar_Scratch_Summon` → "Scratch": suffix dropped, last segment kept. */
export function bg3SummonName(origin: string): string {
    const base = origin.endsWith(SUMMON_SUFFIX) ? origin.slice(0, -SUMMON_SUFFIX.length) : origin;
    const last = base.split('_').filter((s) => s !== '').pop();
    return humaniseBg3Id(last ?? origin);
}

/** `Generic` → "Custom character"; any other origin → "Origin: <humanised id>". */
export function bg3OriginLabel(origin: string): string {
    return origin === GENERIC_ORIGIN ? 'Custom character' : `Origin: ${humaniseBg3Id(origin)}`;
}

/** The line under the party grid: "+1 summon: Scratch", or null with no summons. */
export function bg3SummonsLine(party: readonly { origin: string; isSummon: boolean }[]): string | null {
    const names = party.filter((m) => m.isSummon).map((m) => bg3SummonName(m.origin));
    if (names.length === 0) return null;
    return `+${names.length} ${names.length === 1 ? 'summon' : 'summons'}: ${names.join(', ')}`;
}
