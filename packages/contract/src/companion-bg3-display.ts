// ============================================================
// BG3 display tables (ROK-1954, spec D8) — NOT part of the wire format:
// absent from `schema.json`; editing them needs no version bump or
// CHANGELOG entry. Wire fields stay open bounded strings, so every lookup
// falls back to the raw id (`known: false`) for an id not listed here.
//
// Ship ONLY ids seen in a real save. Recalled ids (prologue `TUT_Avernus_C`,
// Act 3 `BGO_Main_A`/`CTY_Main_A`, `IRN_Main_A`, `END_Main`, other
// difficulties) stay out until a save shows them (spec Q7). Labels other
// than SCL/WLD are recalled, and `DifficultyHard` → "Tactician" awaits Q1.
// ============================================================

/** Story act a level belongs to; `null` for camp, menus, character creation and unknowns. */
export type Bg3Act = 1 | 2 | 3 | null;

/** One level-table row. */
export interface Bg3LevelRow {
    readonly act: Bg3Act;
    readonly label: string;
}

/** Result of `bg3LevelDisplay`. */
export interface Bg3LevelDisplay extends Bg3LevelRow {
    readonly known: boolean;
}

/** Result of `bg3DifficultyDisplay`; `ruleset` is `null` when there is nothing to show. */
export interface Bg3DifficultyDisplay {
    readonly label: string;
    readonly ruleset: string | null;
    readonly known: boolean;
}

/** Level id → act + label (the six ids seen in the sample save). */
export const BG3_LEVEL_DISPLAY: Readonly<Record<string, Bg3LevelRow>> = Object.freeze({
    WLD_Main_A: { act: 1, label: 'Wilderness' },
    CRE_Main_A: { act: 1, label: 'Rosymorn Monastery' },
    SCL_Main_A: { act: 2, label: 'Shadow-Cursed Lands' },
    CRE_AstralPlane_E_Art: { act: null, label: 'Astral Plane' },
    SYS_Menuscreen_Camp_A: { act: null, label: 'Camp' },
    SYS_CC_I: { act: null, label: 'Character creation' },
});

/** Difficulty id → label. */
export const BG3_DIFFICULTY_DISPLAY: Readonly<Record<string, string>> = Object.freeze({
    DifficultyHard: 'Tactician',
});

/** Ruleset id → label; `null` = a known ruleset that shows no label (the standard one). */
export const BG3_RULESET_DISPLAY: Readonly<Record<string, string | null>> = Object.freeze({
    RulesetLarian: null,
});

/** Own-key read, so `constructor`/`__proto__` never resolve to a prototype member. */
function ownRow<T>(table: Readonly<Record<string, T>>, key: string): T | undefined {
    return Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined;
}

/** Display a `currentLevel` id; an unlisted id returns `{act: null, label: id, known: false}`. */
export function bg3LevelDisplay(id: string): Bg3LevelDisplay {
    const row = ownRow(BG3_LEVEL_DISPLAY, id);
    return row === undefined ? { act: null, label: id, known: false } : { ...row, known: true };
}

/**
 * Display a `difficulty` + `ruleset` pair. Unlisted ids fall back to the raw
 * id; `known` is true only when the difficulty and any ruleset are listed.
 */
export function bg3DifficultyDisplay(difficulty: string, ruleset: string | null): Bg3DifficultyDisplay {
    const label = ownRow(BG3_DIFFICULTY_DISPLAY, difficulty);
    if (ruleset === null) return { label: label ?? difficulty, ruleset: null, known: label !== undefined };
    const rulesetLabel = ownRow(BG3_RULESET_DISPLAY, ruleset);
    const known = label !== undefined && rulesetLabel !== undefined;
    return { label: label ?? difficulty, ruleset: rulesetLabel === undefined ? ruleset : rulesetLabel, known };
}
