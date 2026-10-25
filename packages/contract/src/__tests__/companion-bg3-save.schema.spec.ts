import { describe, expect, it } from 'vitest';
import { COMPANION_WEBP_MAX_BYTES } from '../companion-common.schema.js';
import { BG3_PARTY_MAX, Bg3SaveMessageSchema } from '../companion-bg3-save.schema.js';

/** ROK-1954 — `bg3-save` v1 (B1–B9): strict keys at every level, refinements, bounds. */
const must = <T>(v: T | undefined, label: string): T => {
    if (v === undefined) throw new Error(`missing ${label}`);
    return v;
};
const tav = (main: string, sub: string | null, extra: Record<string, unknown> = {}) => ({
    origin: 'Generic', race: 'Human', level: 8, xpLevel: 5590, xpTotal: 35590,
    classes: [{ main, sub }], isSummon: false, ...extra,
});
const scratch = { origin: 'DogFamiliar_Scratch_Summon', race: 'Beast', level: 1, xpLevel: 0, xpTotal: 0, classes: [], isSummon: true };
const thumb = { sha256: 'a'.repeat(64), byteLength: 41_000, contentType: 'image/webp', width: 1280, height: 720 };
const payload = {
    saveName: 'QuickSave_1', savedAt: '2026-10-24T12:00:00Z', campaignKey: '0123456789abcdef'.repeat(4),
    campaignKeySource: 'save-folder', gameVersion: '4.1.1.7631656', platform: 'Steam', currentLevel: 'SCL_Main_A',
    difficulty: 'DifficultyHard', ruleset: 'RulesetLarian',
    party: [
        tav('Barbarian', 'BerserkerPath', { race: 'Elf_WoodElf', xpLevel: 5630, xpTotal: 35630 }), scratch,
        tav('Wizard', 'NecromancySchool'),
        { ...tav('Ranger', 'GloomStalker', { race: 'Duergar' }), classes: [{ main: 'Ranger', sub: 'GloomStalker' }, { main: 'Rogue', sub: 'Thief' }] },
        tav('Paladin', 'Vengeance', { race: 'Tiefling_Asmodeus' }),
    ],
    thumbnail: thumb,
};
const msg = {
    envelopeVersion: 1, contract: 'bg3-save', contractVersion: 1, capturedAt: '2026-10-24T12:00:05Z',
    appVersion: '0.1.0', collectorVersion: '0.1.0', payload,
};
const withPayload = (p: Record<string, unknown>) => ({ ...msg, payload: { ...payload, ...p } });
const withMember = (m: Record<string, unknown>) => withPayload({ party: [{ ...tav('Wizard', null), ...m }] });
const ok = (m: unknown): boolean => Bg3SaveMessageSchema.safeParse(m).success;
const issue = (m: unknown, path: string, code: string): boolean => {
    const res = Bg3SaveMessageSchema.safeParse(m);
    return !res.success && res.error.issues.some((i) => i.path.join('.') === path && i.code === code);
};

describe('Bg3SaveMessageSchema (ROK-1954)', () => {
    it('B1: parses the act2 message with no transforms', () => {
        const res = Bg3SaveMessageSchema.safeParse(msg);
        expect(res.success).toBe(true);
        expect(res.data).toEqual(msg);
    });
    it('B1: pins the contract id and version literals', () => {
        expect(issue({ ...msg, contract: 'bg3-world' }, 'contract', 'invalid_value')).toBe(true);
        expect(issue({ ...msg, contractVersion: 2 }, 'contractVersion', 'invalid_value')).toBe(true);
    });
    it('B2: is strict on the message, payload, member, class and thumbnail', () => {
        const first = must(payload.party[0], 'party[0]');
        expect(issue({ ...msg, token: 'x' }, '', 'unrecognized_keys')).toBe(true);
        expect(issue(withPayload({ subregion: '' }), 'payload', 'unrecognized_keys')).toBe(true);
        expect(issue(withMember({ hp: 10 }), 'payload.party.0', 'unrecognized_keys')).toBe(true);
        expect(issue(withMember({ classes: [{ main: 'Wizard', sub: null, level: 8 }] }), 'payload.party.0.classes.0', 'unrecognized_keys')).toBe(true);
        expect(issue(withPayload({ thumbnail: { ...thumb, alt: 'x' } }), 'payload.thumbnail', 'unrecognized_keys')).toBe(true);
        expect(ok(withPayload({ party: [first] }))).toBe(true);
    });
    it('B3: a member carrying position fails (Position cannot leak)', () => {
        expect(issue(withMember({ position: [0, 0, 0] }), 'payload.party.0', 'unrecognized_keys')).toBe(true);
        expect(issue(withMember({ Position: [0, 0, 0] }), 'payload.party.0', 'unrecognized_keys')).toBe(true);
    });
    it('B4: XP and summon refinements name the member', () => {
        expect(issue(withMember({ xpLevel: 40_000, xpTotal: 35_590 }), 'payload.party.0', 'custom')).toBe(true);
        expect(issue(withPayload({ party: [{ ...scratch, classes: [{ main: 'Fighter', sub: null }] }] }), 'payload.party.0', 'custom')).toBe(true);
        expect(issue(withMember({ classes: [] }), 'payload.party.0', 'custom')).toBe(true);
        expect(ok(withPayload({ party: [scratch] }))).toBe(true);
    });
    it('B4: savedAt must not be after capturedAt', () => {
        expect(issue(withPayload({ savedAt: '2026-10-24T12:00:05.001Z' }), 'payload.savedAt', 'custom')).toBe(true);
        expect(ok(withPayload({ savedAt: '2026-10-24T12:00:05Z' }))).toBe(true);
        expect(ok(withPayload({ savedAt: '2026-10-24T12:00:05.000Z' }))).toBe(true);
    });
    it('B5: party, level and classes are bounded', () => {
        const party = (n: number) => withPayload({ party: Array.from({ length: n }, () => tav('Wizard', null)) });
        expect(issue(party(0), 'payload.party', 'too_small')).toBe(true);
        expect(issue(party(BG3_PARTY_MAX + 1), 'payload.party', 'too_big')).toBe(true);
        expect(ok(party(16))).toBe(true);
        expect(issue(withMember({ level: 0 }), 'payload.party.0.level', 'too_small')).toBe(true);
        expect(issue(withMember({ level: 21 }), 'payload.party.0.level', 'too_big')).toBe(true);
        const classes = Array.from({ length: 13 }, () => ({ main: 'Wizard', sub: null }));
        expect(issue(withMember({ classes }), 'payload.party.0.classes', 'too_big')).toBe(true);
    });
    it('B6: thumbnail is a nullable WebP ref', () => {
        expect(ok(withPayload({ thumbnail: null }))).toBe(true);
        expect(issue(withPayload({ thumbnail: { ...thumb, contentType: 'image/png' } }), 'payload.thumbnail.contentType', 'invalid_value')).toBe(true);
        expect(issue(withPayload({ thumbnail: { ...thumb, byteLength: COMPANION_WEBP_MAX_BYTES + 1 } }), 'payload.thumbnail.byteLength', 'too_big')).toBe(true);
        expect(issue(withPayload({ thumbnail: { ...thumb, width: 4097 } }), 'payload.thumbnail.width', 'too_big')).toBe(true);
        const { thumbnail: _t, ...noThumb } = payload;
        expect(issue({ ...msg, payload: noThumb }, 'payload.thumbnail', 'invalid_type')).toBe(true);
    });
    it('B7: gameVersion admits the 7-digit BG3 build', () => {
        expect(ok(withPayload({ gameVersion: '4.1.1.7631656' }))).toBe(true);
        expect(ok(withPayload({ gameVersion: '4.1' }))).toBe(true);
        expect(issue(withPayload({ gameVersion: 'v4' }), 'payload.gameVersion', 'invalid_format')).toBe(true);
    });
    it('B8: campaignKey is 16–64 lowercase hex, never a raw folder name', () => {
        expect(ok(withPayload({ campaignKey: '0123456789abcdef' }))).toBe(true);
        expect(issue(withPayload({ campaignKey: '0123456789abcde' }), 'payload.campaignKey', 'invalid_format')).toBe(true);
        expect(issue(withPayload({ campaignKey: 'a'.repeat(65) }), 'payload.campaignKey', 'invalid_format')).toBe(true);
        expect(issue(withPayload({ campaignKey: 'ABCDEF0123456789' }), 'payload.campaignKey', 'invalid_format')).toBe(true);
        expect(issue(withPayload({ campaignKey: 'Tav-123__QuickSave' }), 'payload.campaignKey', 'invalid_format')).toBe(true);
        expect(issue(withPayload({ campaignKeySource: 'folder' }), 'payload.campaignKeySource', 'invalid_value')).toBe(true);
    });
    it('B9: ruleset may be null', () => {
        expect(ok(withPayload({ ruleset: null }))).toBe(true);
        expect(issue(withPayload({ ruleset: 'Ruleset Larian' }), 'payload.ruleset', 'invalid_format')).toBe(true);
    });
});
