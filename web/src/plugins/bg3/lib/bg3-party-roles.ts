/**
 * ROK-1958 (operator ruling Q4) — the party coverage strip: which of
 * healer / arcane / tank / face the current party covers. DRAFT table for the
 * operator to veto on the PR. Only class/subclass ids seen in a real save
 * (contract `bg3-save` fixtures) are listed; an unknown id adds no role.
 * Not seen yet (deliberately absent): Bard, Druid, Monk, Sorcerer.
 */
import type { Bg3Class } from '@raid-ledger/contract';

export type Bg3Role = 'healer' | 'arcane' | 'tank' | 'face';

/** Strip order. */
export const BG3_ROLES: readonly Bg3Role[] = Object.freeze(['healer', 'arcane', 'tank', 'face']);

export const BG3_ROLE_LABELS: Readonly<Record<Bg3Role, string>> = Object.freeze({
    healer: 'Healer',
    arcane: 'Arcane',
    tank: 'Tank',
    face: 'Face',
});

/** Main class → roles. `face` = a Charisma class (dialogue checks). */
export const BG3_CLASS_ROLES: Readonly<Record<string, readonly Bg3Role[]>> = Object.freeze({
    Barbarian: ['tank'],
    Cleric: ['healer'],
    Fighter: ['tank'],
    Paladin: ['tank', 'healer', 'face'],
    Ranger: [],
    Rogue: [],
    Warlock: ['arcane', 'face'],
    Wizard: ['arcane'],
});

/**
 * Subclass → roles it ADDS on top of its class. No seen subclass
 * (BerserkerPath, Fiend, GloomStalker, NecromancySchool, Thief, Vengeance)
 * changes its class's roles; add e.g. `EldritchKnight: ['arcane']` once a
 * save shows it.
 */
export const BG3_SUBCLASS_ROLES: Readonly<Record<string, readonly Bg3Role[]>> = Object.freeze({});

function own(table: Readonly<Record<string, readonly Bg3Role[]>>, key: string): readonly Bg3Role[] {
    return Object.prototype.hasOwnProperty.call(table, key) ? (table[key] ?? []) : [];
}

/** Every role a member's class entries give (multiclass = union). */
export function bg3MemberRoles(classes: readonly Bg3Class[]): ReadonlySet<Bg3Role> {
    const roles = new Set<Bg3Role>();
    for (const c of classes) {
        own(BG3_CLASS_ROLES, c.main).forEach((r) => roles.add(r));
        if (c.sub !== null) own(BG3_SUBCLASS_ROLES, c.sub).forEach((r) => roles.add(r));
    }
    return roles;
}

export interface Bg3RoleCoverage {
    readonly role: Bg3Role;
    readonly label: string;
    readonly covered: boolean;
}

/** The four roles in strip order, each covered when any non-summon member has it. */
export function coverage(
    party: readonly { classes: readonly Bg3Class[]; isSummon: boolean }[],
): Bg3RoleCoverage[] {
    const covered = new Set<Bg3Role>();
    for (const m of party) {
        if (!m.isSummon) bg3MemberRoles(m.classes).forEach((r) => covered.add(r));
    }
    return BG3_ROLES.map((role) => ({ role, label: BG3_ROLE_LABELS[role], covered: covered.has(role) }));
}
