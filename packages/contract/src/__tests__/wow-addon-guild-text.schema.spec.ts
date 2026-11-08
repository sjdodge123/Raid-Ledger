/**
 * ROK-2137 (guild text sync P1) — the LedgerLink `guild` section gains the
 * optional in-game MOTD (`motd`, ≤255) and Guild Information (`infoText`,
 * ≤499). Additive: an export without them is unchanged v1; an empty string
 * is a real report ("the in-game box is empty"), absent = no opinion.
 */
import { describe, it, expect } from 'vitest';
import {
    AddonExportSchema,
    AddonGuildDataSchema,
    WOW_GUILD_INFO_MAX,
    WOW_GUILD_MOTD_MAX,
} from '../index.js';

const member = {
    guid: 'Player-1234-0ABCDEF0', name: 'Ana Forever', rankIndex: 0, rank: 'Guild Master',
    level: 60, class: 'PALADIN', online: true,
};
const data = { name: 'Night Shift', snapshotAt: 1_790_000_000, canViewOfficerNote: false, members: [member] };
const guildExport = {
    schema: 1,
    addonVersion: '0.1.0',
    client: { interface: 16001, build: '1.60.1.70009', locale: 'enUS', region: 1 },
    exportedAt: 1_790_000_000,
    who: {
        guid: 'Player-1234-0ABCDEF0', fullName: 'Ana Forever', raw: { getUnitName: 'Ana Forever' },
        ruleset: 'normal', class: 'PALADIN', race: 'Dwarf', level: 60, faction: 'Alliance',
    },
    section: 'guild',
    data,
};
const ok = (d: Record<string, unknown>) => AddonGuildDataSchema.safeParse(d).success;

describe('AddonGuildDataSchema — in-game MOTD + Guild Information (ROK-2137)', () => {
    it('accepts an export without either field (unchanged v1)', () => {
        const parsed = AddonGuildDataSchema.parse(data);
        expect(parsed.motd).toBeUndefined();
        expect(parsed.infoText).toBeUndefined();
    });

    it('accepts both fields and keeps the text verbatim', () => {
        const parsed = AddonGuildDataSchema.parse({ ...data, motd: 'Raid Thu 8pm |cffff0000MC|r', infoText: 'Line 1\nLine 2' });
        expect(parsed.motd).toBe('Raid Thu 8pm |cffff0000MC|r');
        expect(parsed.infoText).toBe('Line 1\nLine 2');
    });

    it('accepts an empty string (the in-game box is empty)', () => {
        expect(ok({ ...data, motd: '', infoText: '' })).toBe(true);
    });

    it('accepts text at exactly the in-game caps', () => {
        expect(WOW_GUILD_MOTD_MAX).toBe(255);
        expect(WOW_GUILD_INFO_MAX).toBe(499);
        expect(ok({ ...data, motd: 'm'.repeat(255), infoText: 'i'.repeat(499) })).toBe(true);
    });

    it.each([
        ['motd over 255', { motd: 'm'.repeat(256) }],
        ['infoText over 499', { infoText: 'i'.repeat(500) }],
        ['a non-string motd', { motd: 42 }],
        ['a null infoText', { infoText: null }],
    ])('rejects %s', (_label, extra) => {
        expect(ok({ ...data, ...extra })).toBe(false);
    });

    it('still rejects an unknown guild key (strictness kept, e.g. officer text)', () => {
        expect(ok({ ...data, officerInfo: 'secret' })).toBe(false);
    });

    it('a full guild export with both fields passes the export schema', () => {
        const full = { ...guildExport, data: { ...data, motd: 'Hi', infoText: 'About us' } };
        expect(AddonExportSchema.safeParse(full).success).toBe(true);
    });
});
