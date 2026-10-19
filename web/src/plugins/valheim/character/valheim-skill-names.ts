/**
 * ROK-1836 D12 — vanilla `Skills.SkillType` ids → display names. The wire
 * sends ids only; a modded skill arrives as a signed integer string.
 */
import type { ValheimSkill } from '@raid-ledger/contract';

const VANILLA_SKILL_NAMES: ReadonlyMap<string, string> = new Map(
    Object.entries({
        Swords: 'Swords',
        Knives: 'Knives',
        Clubs: 'Clubs',
        Polearms: 'Polearms',
        Spears: 'Spears',
        Blocking: 'Blocking',
        Axes: 'Axes',
        Bows: 'Bows',
        Crossbows: 'Crossbows',
        Unarmed: 'Unarmed',
        ElementalMagic: 'Elemental magic',
        BloodMagic: 'Blood magic',
        Pickaxes: 'Pickaxes',
        WoodCutting: 'Woodcutting',
        Jump: 'Jump',
        Sneak: 'Sneak',
        Run: 'Run',
        Swim: 'Swim',
        Fishing: 'Fishing',
        Cooking: 'Cooking',
        Farming: 'Farming',
        Crafting: 'Crafting',
        Ride: 'Riding',
        Dodge: 'Dodge',
    }),
);

/** The display name: a vanilla name, "Modded skill <id>" for a numeric id, else the id humanised. */
export function valheimSkillName(id: string): string {
    // A Map, not an object index: ids like `__proto__` / `constructor` must not read inherited members.
    const known = VANILLA_SKILL_NAMES.get(id);
    if (known !== undefined) return known;
    if (/^-?\d+$/.test(id)) return `Modded skill ${id}`;
    const spaced = id
        .replace(/_/g, ' ')
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .trim();
    return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

/** Highest level first; ties by display name so the order is stable. */
export function sortSkillsByLevel(
    skills: readonly ValheimSkill[],
): ValheimSkill[] {
    return [...skills].sort(
        (a, b) =>
            b.level - a.level ||
            valheimSkillName(a.id).localeCompare(valheimSkillName(b.id)),
    );
}
