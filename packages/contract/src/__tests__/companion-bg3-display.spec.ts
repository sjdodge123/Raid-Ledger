import { describe, expect, it } from 'vitest';
import {
    BG3_DIFFICULTY_DISPLAY,
    BG3_LEVEL_DISPLAY,
    BG3_RULESET_DISPLAY,
    bg3DifficultyDisplay,
    bg3LevelDisplay,
} from '../companion-bg3-display.js';

/** ROK-1954 — BG3 display tables (D1–D2): open-set lookups with a raw-id fallback. */
const SAVE_VERIFIED_LEVEL_IDS = ['CRE_AstralPlane_E_Art', 'CRE_Main_A', 'SCL_Main_A', 'SYS_CC_I', 'SYS_Menuscreen_Camp_A', 'WLD_Main_A'];

describe('bg3LevelDisplay (ROK-1954)', () => {
    it('D1: a shipped id resolves to its act and label', () => {
        expect(bg3LevelDisplay('SCL_Main_A')).toEqual({ act: 2, label: 'Shadow-Cursed Lands', known: true });
        expect(bg3LevelDisplay('WLD_Main_A')).toEqual({ act: 1, label: 'Wilderness', known: true });
        expect(bg3LevelDisplay('SYS_Menuscreen_Camp_A')).toEqual({ act: null, label: 'Camp', known: true });
    });
    it('D1: an unshipped (recalled) id falls back to the raw id', () => {
        expect(bg3LevelDisplay('TUT_Avernus_C')).toEqual({ act: null, label: 'TUT_Avernus_C', known: false });
        expect(bg3LevelDisplay('BGO_Main_A')).toEqual({ act: null, label: 'BGO_Main_A', known: false });
    });
    it('D1: prototype keys are not table rows', () => {
        expect(bg3LevelDisplay('constructor')).toEqual({ act: null, label: 'constructor', known: false });
        expect(bg3LevelDisplay('__proto__')).toEqual({ act: null, label: '__proto__', known: false });
    });
    it('D2: the level table holds exactly the six save-verified ids', () => {
        expect(Object.keys(BG3_LEVEL_DISPLAY).sort()).toEqual(SAVE_VERIFIED_LEVEL_IDS);
    });
});

describe('bg3DifficultyDisplay (ROK-1954)', () => {
    it('D2: the difficulty and ruleset tables hold only save-verified ids', () => {
        expect(Object.keys(BG3_DIFFICULTY_DISPLAY)).toEqual(['DifficultyHard']);
        expect(Object.keys(BG3_RULESET_DISPLAY)).toEqual(['RulesetLarian']);
    });
    it('DifficultyHard is Tactician and RulesetLarian shows no label (Q1)', () => {
        expect(bg3DifficultyDisplay('DifficultyHard', 'RulesetLarian')).toEqual({ label: 'Tactician', ruleset: null, known: true });
        expect(bg3DifficultyDisplay('DifficultyHard', null)).toEqual({ label: 'Tactician', ruleset: null, known: true });
    });
    it('unknown difficulty or ruleset ids fall back to the raw id', () => {
        expect(bg3DifficultyDisplay('DifficultyHonour', null)).toEqual({ label: 'DifficultyHonour', ruleset: null, known: false });
        expect(bg3DifficultyDisplay('DifficultyHard', 'RulesetCustom')).toEqual({ label: 'Tactician', ruleset: 'RulesetCustom', known: false });
        expect(bg3DifficultyDisplay('toString', 'constructor')).toEqual({ label: 'toString', ruleset: 'constructor', known: false });
    });
});
