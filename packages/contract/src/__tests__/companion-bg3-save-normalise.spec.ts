import { describe, expect, it } from 'vitest';
import { Bg3SavePayloadSchema } from '../companion-bg3-save.schema.js';
import { Bg3SaveInfoRawSchema } from '../companion-bg3-save-raw.schema.js';
import { normaliseBg3SaveInfo } from '../companion-bg3-save-normalise.js';
import type { Bg3SaveNormaliseMeta } from '../companion-bg3-save-normalise.js';

/** ROK-1954 — reference normaliser (N1–N5): raw `SaveInfo.json` → `Bg3SavePayload`. */
const must = <T>(v: T | undefined, label: string): T => {
    if (v === undefined) throw new Error(`missing ${label}`);
    return v;
};
const zero = [0, 0, 0];
/** Inline copy of `fixtures/saveinfo/act2-party-4p-summon.saveinfo.json`. */
const act2Raw = {
    'Active Party': {
        Characters: [
            { Classes: [{ Main: 'Barbarian', Sub: 'BerserkerPath' }], 'Experience Points (Current level)': 5630, 'Experience Points (Total)': 35630, Level: 8, Origin: 'Generic', Position: zero, Race: 'Elf_WoodElf', Subregion: '' },
            { 'Experience Points (Current level)': 0, 'Experience Points (Total)': 0, Level: 1, Origin: 'DogFamiliar_Scratch_Summon', Position: zero, Race: 'Beast', Subregion: '' },
            { Classes: [{ Main: 'Wizard', Sub: 'NecromancySchool' }], 'Experience Points (Current level)': 5590, 'Experience Points (Total)': 35590, Level: 8, Origin: 'Generic', Position: zero, Race: 'Human', Subregion: '' },
            { Classes: [{ Main: 'Ranger', Sub: 'GloomStalker' }, { Main: 'Rogue', Sub: 'Thief' }], 'Experience Points (Current level)': 5390, 'Experience Points (Total)': 35390, Level: 8, Origin: 'Generic', Position: zero, Race: 'Duergar', Subregion: '' },
            { Classes: [{ Main: 'Paladin', Sub: 'Vengeance' }], 'Experience Points (Current level)': 5630, 'Experience Points (Total)': 35630, Level: 8, Origin: 'Generic', Position: zero, Race: 'Tiefling_Asmodeus', Subregion: '' },
        ],
    },
    'Current Level': 'SCL_Main_A',
    Difficulty: ['DifficultyHard', 'RulesetLarian'],
    'Game Version': '4.1.1.7631656',
    Platform: 'Steam',
    'Save Name': 'QuickSave_1',
};
const meta: Bg3SaveNormaliseMeta = {
    savedAt: '2026-10-24T12:00:00Z',
    campaignKey: '0123456789abcdef'.repeat(4),
    campaignKeySource: 'save-folder',
    thumbnail: null,
};
const MEMBER_KEYS = ['classes', 'isSummon', 'level', 'origin', 'race', 'xpLevel', 'xpTotal'];
const PAYLOAD_KEYS = ['campaignKey', 'campaignKeySource', 'currentLevel', 'difficulty', 'gameVersion', 'party', 'platform', 'ruleset', 'saveName', 'savedAt', 'thumbnail'];

/** Parse `raw` with the loose raw schema (fails loudly), then normalise it. */
const run = (raw: unknown) => {
    const parsed = Bg3SaveInfoRawSchema.safeParse(raw);
    if (!parsed.success) throw new Error(`raw parse failed: ${parsed.error.message}`);
    return normaliseBg3SaveInfo(parsed.data, meta);
};
const withChar = (patch: Record<string, unknown>, drop: readonly string[] = []) => {
    const first = must(act2Raw['Active Party'].Characters[0], 'char 0');
    const char: Record<string, unknown> = { ...first, ...patch };
    for (const k of drop) delete char[k];
    return { ...act2Raw, 'Active Party': { Characters: [char] } };
};

describe('Bg3SaveInfoRawSchema (ROK-1954)', () => {
    it('accepts the act2 raw file and a one-element Difficulty; rejects an empty or 5-element tuple', () => {
        expect(Bg3SaveInfoRawSchema.safeParse(act2Raw).success).toBe(true);
        expect(Bg3SaveInfoRawSchema.safeParse({ ...act2Raw, Difficulty: ['DifficultyHard'] }).success).toBe(true);
        expect(Bg3SaveInfoRawSchema.safeParse({ ...act2Raw, Difficulty: [] }).success).toBe(false);
        expect(Bg3SaveInfoRawSchema.safeParse({ ...act2Raw, Difficulty: ['a', 'b', 'c', 'd', 'e'] }).success).toBe(false);
    });
    it('rejects a character missing a key the normaliser reads', () => {
        expect(Bg3SaveInfoRawSchema.safeParse(withChar({}, ['Race'])).success).toBe(false);
        expect(Bg3SaveInfoRawSchema.safeParse(withChar({ Level: 'eight' })).success).toBe(false);
    });
});

describe('normaliseBg3SaveInfo (ROK-1954)', () => {
    it('N1: the act2 raw file normalises to a payload the wire schema accepts', () => {
        const out = run(act2Raw);
        const parsed = Bg3SavePayloadSchema.safeParse(out);
        expect(parsed.success).toBe(true);
        expect(Object.keys(out).sort()).toEqual(PAYLOAD_KEYS);
        expect(out).toMatchObject({
            saveName: 'QuickSave_1', savedAt: meta.savedAt, campaignKey: meta.campaignKey, campaignKeySource: 'save-folder',
            gameVersion: '4.1.1.7631656', platform: 'Steam', currentLevel: 'SCL_Main_A',
            difficulty: 'DifficultyHard', ruleset: 'RulesetLarian', thumbnail: null,
        });
        expect(out.party.map((m) => m.origin)).toEqual(['Generic', 'DogFamiliar_Scratch_Summon', 'Generic', 'Generic', 'Generic']);
        expect(out.party[0]).toEqual({ origin: 'Generic', race: 'Elf_WoodElf', level: 8, xpLevel: 5630, xpTotal: 35630, classes: [{ main: 'Barbarian', sub: 'BerserkerPath' }], isSummon: false });
    });
    it('N1: member 1 is the summon with no classes; member 3 keeps two classes in order', () => {
        const out = run(act2Raw);
        expect(out.party[1]).toMatchObject({ isSummon: true, classes: [], race: 'Beast', level: 1 });
        expect(out.party[3]?.classes).toEqual([{ main: 'Ranger', sub: 'GloomStalker' }, { main: 'Rogue', sub: 'Thief' }]);
        expect(out.party.filter((m) => m.isSummon)).toHaveLength(1);
    });
    it('N1: passes the thumbnail ref through from meta', () => {
        const thumbnail = { sha256: 'b'.repeat(64), byteLength: 41_000, contentType: 'image/webp' as const, width: 1280, height: 720 };
        const parsed = Bg3SaveInfoRawSchema.parse(act2Raw);
        expect(normaliseBg3SaveInfo(parsed, { ...meta, thumbnail }).thumbnail).toEqual(thumbnail);
    });
    it('N2: no member carries position or subregion (exact key pin)', () => {
        for (const m of run(act2Raw).party) expect(Object.keys(m).sort()).toEqual(MEMBER_KEYS);
    });
    it('N3: Sub "" and a missing Sub both become null', () => {
        const empty = run(withChar({ Classes: [{ Main: 'Wizard', Sub: '' }] }));
        const missing = run(withChar({ Classes: [{ Main: 'Wizard' }] }));
        expect(empty.party[0]?.classes).toEqual([{ main: 'Wizard', sub: null }]);
        expect(missing.party[0]?.classes).toEqual([{ main: 'Wizard', sub: null }]);
    });
    it('N4: a one-element Difficulty gives ruleset null', () => {
        const out = run({ ...act2Raw, Difficulty: ['DifficultyHard'] });
        expect(out.difficulty).toBe('DifficultyHard');
        expect(out.ruleset).toBeNull();
        expect(Bg3SavePayloadSchema.safeParse(out).success).toBe(true);
    });
    it('N5: unknown raw keys at every level are ignored and absent from the output', () => {
        const raw = {
            ...withChar({ Classes: [{ Main: 'Wizard', Sub: 'Evocation', Level: 8 }], Hp: 40 }),
            'Party Gold': 900,
        };
        const out = run(raw);
        expect(Object.keys(out).sort()).toEqual(PAYLOAD_KEYS);
        expect(Object.keys(must(out.party[0], 'member 0')).sort()).toEqual(MEMBER_KEYS);
        expect(out.party[0]?.classes).toEqual([{ main: 'Wizard', sub: 'Evocation' }]);
    });
});
