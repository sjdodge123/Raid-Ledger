/**
 * ROK-2148 — the LedgerLink `char` section gains an optional `mailworthy`
 * block (guild template, Mailworthy peers, guild-rule givers). Additive:
 * a char export without it is unchanged v1; every object is `.strict()`.
 * Spec §A.2, test T6 (+ the D.3 read DTO and stored-jsonb schemas).
 */
import { describe, it, expect } from 'vitest';
import {
    ADDON_MAILWORTHY_DAYS_MAX,
    ADDON_MAILWORTHY_GIVERS_MAX,
    ADDON_MAILWORTHY_NAME_MAX,
    ADDON_MAILWORTHY_PEERS_MAX,
    ADDON_MAILWORTHY_RULES_MAX,
    AddonCharDataSchema,
    AddonMailworthySchema,
    GuildContributionsDtoSchema,
    GuildMailworthyStoredDaysSchema,
    GuildMailworthyStoredRulesSchema,
    WOW_CRAFTING_SKILL_LINES,
    wowCraftingMasterTitle,
    wowCraftingProfessionName,
} from '../index.js';

const rules = [
    { professionSkillLineId: 333, recipientName: 'Aldren' },
    { professionSkillLineId: 171, recipientName: 'Morwenna' },
];
const block = {
    generatedAt: 1_789_999_940,
    template: { rev: 1_789_000_000, author: 'Thessaly', rules },
    peers: [{ name: 'Brannoc', lastSeenAt: 1_789_990_000 }],
    givers: [{
        characterName: 'Ana', itemsAllTime: 41, countingSince: 1_786_000_000,
        asOf: 1_789_999_940, days: [{ day: 20_716, items: 3 }],
    }],
};
const charData = {
    gear: [], talents: { configId: 7, nodes: [] }, lockouts: [],
};
const ok = (b: unknown) => AddonMailworthySchema.safeParse(b).success;
const giver = (over: Record<string, unknown>) => ({ ...block.givers[0], ...over });

describe('AddonMailworthySchema — wire block (ROK-2148 §A.2)', () => {
    it('pins the caps from the spec', () => {
        expect([
            ADDON_MAILWORTHY_NAME_MAX, ADDON_MAILWORTHY_RULES_MAX, ADDON_MAILWORTHY_PEERS_MAX,
            ADDON_MAILWORTHY_GIVERS_MAX, ADDON_MAILWORTHY_DAYS_MAX,
        ]).toEqual([48, 8, 1000, 200, 35]);
    });

    it('accepts the full block and a template-only block', () => {
        expect(ok(block)).toBe(true);
        expect(ok({ generatedAt: block.generatedAt, template: block.template })).toBe(true);
    });

    it('accepts a block with only generatedAt (no opinion on anything)', () => {
        expect(ok({ generatedAt: block.generatedAt })).toBe(true);
    });

    it('accepts a guildmate total computed before generatedAt (in-game relay, delta 2026-11-08)', () => {
        expect(ok({ ...block, givers: [giver({ characterName: 'Brannoc', asOf: 1_789_000_000 })] })).toBe(true);
    });

    it('accepts an empty rules array (a template published with no rules)', () => {
        expect(ok({ ...block, template: { ...block.template, rules: [] } })).toBe(true);
    });

    it('accepts 200 givers (relayed guildmates)', () => {
        expect(ok({ ...block, givers: Array.from({ length: 200 }, () => block.givers[0]) })).toBe(true);
    });

    it('char data stays valid without the block and accepts it when present', () => {
        expect(AddonCharDataSchema.parse(charData).mailworthy).toBeUndefined();
        expect(AddonCharDataSchema.parse({ ...charData, mailworthy: block }).mailworthy).toEqual(block);
    });

    it.each([
        ['a 49-char peer name', { ...block, peers: [{ name: 'n'.repeat(49), lastSeenAt: 1_789_990_000 }] }],
        ['an empty recipient name', { ...block, template: { ...block.template, rules: [{ professionSkillLineId: 333, recipientName: '' }] } }],
        ['a negative day items count', { ...block, givers: [giver({ days: [{ day: 20_716, items: -1 }] })] }],
        ['a millisecond template rev', { ...block, template: { ...block.template, rev: 1_789_000_000_000 } }],
        ['a 36th day', { ...block, givers: [giver({ days: Array.from({ length: 36 }, (_, i) => ({ day: 20_680 + i, items: 1 })) })] }],
        ['9 rules', { ...block, template: { ...block.template, rules: Array.from({ length: 9 }, (_, i) => ({ professionSkillLineId: i + 1, recipientName: 'R' })) } }],
        ['a rule carrying a per-unit cap', { ...block, template: { ...block.template, rules: [{ ...rules[0], cap: 500 }] } }],
        ['201 givers', { ...block, givers: Array.from({ length: 201 }, () => block.givers[0]) }],
        ['a giver without asOf', { ...block, givers: [giver({ asOf: undefined })] }],
        ['a giver asOf after generatedAt', { ...block, givers: [giver({ asOf: block.generatedAt + 1 })] }],
        ['a millisecond giver asOf', { ...block, givers: [giver({ asOf: 1_789_999_940_000 })] }],
        ['an unknown block key', { ...block, log: [] }],
        ['a missing generatedAt', { template: block.template }],
        ['a zero skill line id', { ...block, template: { ...block.template, rules: [{ professionSkillLineId: 0, recipientName: 'R' }] } }],
    ])('rejects %s', (_label, bad) => {
        expect(ok(bad)).toBe(false);
    });
});

describe('stored jsonb re-parse schemas (ROK-2148 §D.1)', () => {
    it('accepts the stored rule and day arrays and rejects a widened row', () => {
        expect(GuildMailworthyStoredRulesSchema.safeParse(rules).success).toBe(true);
        expect(GuildMailworthyStoredDaysSchema.safeParse([{ day: 20_716, items: 3 }]).success).toBe(true);
        expect(GuildMailworthyStoredRulesSchema.safeParse([{ ...rules[0], cap: 1 }]).success).toBe(false);
        expect(GuildMailworthyStoredDaysSchema.safeParse([{ day: 1, items: 'x' }]).success).toBe(false);
    });
});

describe('crafting skill lines + master titles (D7, round-2 label ruling)', () => {
    it('maps the eight crafting skill lines', () => {
        expect(WOW_CRAFTING_SKILL_LINES).toEqual({
            171: 'Alchemy', 164: 'Blacksmithing', 333: 'Enchanting', 202: 'Engineering',
            165: 'Leatherworking', 197: 'Tailoring', 185: 'Cooking', 129: 'First Aid',
        });
    });

    it('names known and unknown professions', () => {
        expect(wowCraftingProfessionName(333)).toBe('Enchanting');
        expect(wowCraftingProfessionName(999)).toBe('Profession 999');
    });

    it('titles masters "Guild Enchanter" style, with a fallback for unknown ids', () => {
        expect(wowCraftingMasterTitle(333)).toBe('Guild Enchanter');
        expect(wowCraftingMasterTitle(197)).toBe('Guild Tailor');
        expect(wowCraftingMasterTitle(171)).toBe('Guild Alchemist');
        expect(wowCraftingMasterTitle(999)).toBe('Guild Profession 999 master');
    });
});

const CHAR = '0b6a3f0e-2f4c-4e0a-9d5b-1c2d3e4f5a6b';
const giverRow = {
    rank: 14, characterName: 'Brannoc', characterId: CHAR,
    characterCount: 2, items: 3, isYou: true,
};
const dto = {
    template: { rev: '2026-11-02T10:00:00.000Z', authorName: 'Thessaly', authorCharacterId: null },
    masters: [{
        professionSkillLineId: 333, profession: 'Enchanting', title: 'Guild Enchanter',
        recipientName: 'Aldren', characterId: CHAR, onRoster: true,
    }],
    givers: {
        last30Days: [{ ...giverRow, rank: 1, isYou: false, characterCount: 1 }],
        allTime: [],
        youLast30Days: giverRow,
        youAllTime: null,
        last30DaysTotal: 611, allTimeTotal: 7452,
        countingSince: '2026-08-14T00:00:00.000Z', asOf: '2026-11-08T20:00:00.000Z',
    },
    users: [{ characterName: 'Brannoc', characterId: null, lastSeenAt: '2026-11-08T19:00:00.000Z' }],
};

describe('GuildContributionsDtoSchema — read DTO (D.3 + round 2)', () => {
    it('accepts a per-player giver row carrying the RL user and the "you" marker', () => {
        expect(GuildContributionsDtoSchema.parse(dto)).toEqual(dto);
    });

    it('accepts the empty DTO (no template, no givers, no users)', () => {
        const empty = {
            template: null, masters: [], users: [],
            givers: {
                last30Days: [], allTime: [], youLast30Days: null, youAllTime: null,
                last30DaysTotal: 0, allTimeTotal: 0, countingSince: null, asOf: null,
            },
        };
        expect(GuildContributionsDtoSchema.safeParse(empty).success).toBe(true);
    });

    it.each([
        ['11 top givers', { ...dto, givers: { ...dto.givers, last30Days: Array.from({ length: 11 }, () => giverRow) } }],
        ['a rank 0', { ...dto, givers: { ...dto.givers, youLast30Days: { ...giverRow, rank: 0 } } }],
        ['a giver without isYou', { ...dto, givers: { ...dto.givers, youLast30Days: { ...giverRow, isYou: undefined } } }],
        ['a non-uuid characterId', { ...dto, users: [{ ...dto.users[0], characterId: 'abc' }] }],
        ['an unknown top-level key', { ...dto, extra: 1 }],
    ])('rejects %s', (_label, bad) => {
        expect(GuildContributionsDtoSchema.safeParse(bad).success).toBe(false);
    });
});
