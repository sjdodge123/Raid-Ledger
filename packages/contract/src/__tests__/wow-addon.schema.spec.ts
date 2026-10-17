/**
 * ROK-1724 — the addon export envelope (what ROK-1723 must emit) and the
 * import request. Strictness is the officer-note guarantee (Q4), so the
 * reject cases here are the point. Imported through the barrel on purpose:
 * the schema files import the Forever schemas back through it.
 */
import { describe, it, expect } from 'vitest';
import {
    ADDON_IMPORT_PAGE_RE,
    AddonCharSnapshotDataSchema,
    AddonExportSchema,
    AddonImportRequestSchema,
} from '../index.js';

const who = {
    guid: 'Player-1234-0ABCDEF0',
    fullName: 'Ana Forever',
    raw: { getUnitName: 'Ana Forever', unitName: ['Ana', null], unitFullName: ['Ana', 'Forever'], realmName: '?' },
    ruleset: 'normal',
    class: 'PALADIN',
    race: 'Dwarf',
    level: 60,
    faction: 'Alliance',
    guildName: 'Night Shift',
};
const envelope = {
    schema: 1,
    addonVersion: '0.1.0',
    client: { interface: 16001, build: '1.60.1.70009', locale: 'enUS', region: 1 },
    exportedAt: 1_790_000_000,
    who,
};
const charExport = {
    ...envelope,
    section: 'char',
    data: {
        gear: [{ slot: 1, itemId: 19019, link: '|cffa335ee|Hitem:19019::::::::60:::::|h[Thunderfury]|h|r', ilvl: 80 }],
        talents: { configId: 7, nodes: [{ nodeId: 101, rank: 2, entryId: 9001 }] },
        lockouts: [{ name: 'Molten Core', instanceId: 409, difficultyId: 9, resetAt: 1_790_500_000, killed: 3, total: 10 }],
    },
};
const member = {
    guid: 'Player-1234-0ABCDEF0', name: 'Ana Forever', rankIndex: 0, rank: 'Guild Master',
    level: 60, class: 'PALADIN', online: true, lastOnlineDays: 0, note: 'tank',
};
const guildExport = {
    ...envelope,
    section: 'guild',
    data: { name: 'Night Shift', snapshotAt: 1_790_000_000, canViewOfficerNote: false, members: [member] },
};
const raidExport = {
    ...envelope,
    section: 'raid',
    data: {
        pulls: [{
            encounterId: 663, name: 'Lucifron', difficultyId: 9, groupSize: 40, instanceId: 409,
            startAt: 1_790_000_000, endAt: 1_790_000_120, success: true,
            roster: ['Player-1234-0ABCDEF0'], rosterNames: ['Ana Forever'],
        }],
    },
};

const ok = (v: unknown) => AddonExportSchema.safeParse(v).success;

describe('AddonExportSchema — canonical fixtures', () => {
    it.each([['char', charExport], ['guild', guildExport], ['raid', raidExport]])(
        'parses a canonical %s export',
        (_section, payload) => {
            expect(AddonExportSchema.parse(payload)).toEqual(payload);
        },
    );

    it('accepts a missing guildName and a null ruleset', () => {
        const { guildName: _omit, ...noGuild } = who;
        expect(ok({ ...charExport, who: { ...noGuild, ruleset: null } })).toBe(true);
    });
});

describe('AddonExportSchema — strictness (Q4: unknown keys reject the whole string)', () => {
    it('rejects an officerNote on a guild member', () => {
        const withOfficer = { ...guildExport, data: { ...guildExport.data, members: [{ ...member, officerNote: 'loot ninja' }] } };
        const result = AddonExportSchema.safeParse(withOfficer);
        expect(result.success).toBe(false);
        expect(result.error?.issues[0]).toMatchObject({ code: 'unrecognized_keys', keys: ['officerNote'] });
    });

    it('rejects canViewOfficerNote: true', () => {
        expect(ok({ ...guildExport, data: { ...guildExport.data, canViewOfficerNote: true } })).toBe(false);
    });

    it.each([
        ['top level', { ...charExport, extra: 1 }],
        ['who', { ...charExport, who: { ...who, realm: 'x' } }],
        ['who.raw', { ...charExport, who: { ...who, raw: { ...who.raw, zone: 'x' } } }],
        ['client', { ...charExport, client: { ...envelope.client, os: 'mac' } }],
        ['char data', { ...charExport, data: { ...charExport.data, dps: [] } }],
        ['raid pull', { ...raidExport, data: { pulls: [{ ...raidExport.data.pulls[0], dps: 1 }] } }],
    ])('rejects an unknown key in %s', (_where, payload) => {
        expect(ok(payload)).toBe(false);
    });
});

describe('AddonExportSchema — field rules', () => {
    it('accepts the ruleset spelled roleplaying (Q5)', () => {
        expect(ok({ ...charExport, who: { ...who, ruleset: 'roleplaying' } })).toBe(true);
    });

    it.each(['rp', 'roleplay', 'RP', 'Roleplaying'])('rejects the ruleset %s', (ruleset) => {
        expect(ok({ ...charExport, who: { ...who, ruleset } })).toBe(false);
    });

    it.each([
        ['schema 2', { ...charExport, schema: 2 }],
        ['a header/data section mismatch', { ...charExport, section: 'guild' }],
        ['a malformed guid', { ...charExport, who: { ...who, guid: 'Player-1234-0abcdef0' } }],
        ['a millisecond exportedAt', { ...charExport, exportedAt: 1_790_000_000_000 }],
        ['region 6', { ...charExport, client: { ...envelope.client, region: 6 } }],
        ['2001 guild members', { ...guildExport, data: { ...guildExport.data, members: Array(2001).fill(member) } }],
        ['41 roster guids', { ...raidExport, data: { pulls: [{ ...raidExport.data.pulls[0], roster: Array(41).fill(who.guid) }] } }],
    ])('rejects %s', (_case, payload) => {
        expect(ok(payload)).toBe(false);
    });
});

describe('AddonCharSnapshotDataSchema (frozen for ROK-1727)', () => {
    it('stores bonusIds instead of the link, and rejects a link', () => {
        const gear = [{ slot: 1, itemId: 19019, ilvl: 80, bonusIds: [] }];
        const data = { ...charExport.data, gear };
        expect(AddonCharSnapshotDataSchema.safeParse(data).success).toBe(true);
        expect(AddonCharSnapshotDataSchema.safeParse({ ...data, gear: [{ ...gear[0], link: 'x' }] }).success).toBe(false);
    });
});

describe('AddonImportRequestSchema + ADDON_IMPORT_PAGE_RE', () => {
    it('defaults dryRun to true and rejects unknown keys', () => {
        expect(AddonImportRequestSchema.parse({ importString: '!RL1!char!AAAA' }).dryRun).toBe(true);
        expect(AddonImportRequestSchema.safeParse({ importString: 'x', force: true }).success).toBe(false);
        expect(AddonImportRequestSchema.safeParse({ importString: 'x', confirm: { skip: true } }).success).toBe(false);
    });

    it.each(['!RL1!char!eJyrVg==', '!RL1!guild-2of3!eJyrVg=='])('matches %s', (page) => {
        expect(ADDON_IMPORT_PAGE_RE.test(page)).toBe(true);
    });

    it.each(['!RL1!all!eJyrVg==', 'RL1!char!eJyrVg==', '!RL1!char!eJy-_Vg', '!RL1!char!'])('rejects %s', (page) => {
        expect(ADDON_IMPORT_PAGE_RE.test(page)).toBe(false);
    });
});
