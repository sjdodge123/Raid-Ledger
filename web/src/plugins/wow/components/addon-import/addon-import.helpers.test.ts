import { describe, it, expect } from 'vitest';
import { ADDON_IMPORT_MAX_BYTES, type AddonImportResultDto } from '@raid-ledger/contract';
import {
    canApplyAddonImport, diffRows, formatKb, importStringBytes, importStringHeaderLabel,
    mailworthyRow, provenanceLine, resultHeadline, sendableImportString, summaryRows,
} from './addon-import.helpers';
import { CHAR_STRING, EXPORTED_AT, charResult } from './addon-import.test-fixtures';

describe('importStringHeaderLabel', () => {
    it('labels an unpaged section with its version', () => {
        expect(importStringHeaderLabel(`  ${CHAR_STRING}\n`)).toBe('Character · RL1');
    });
    it('labels one page of a paged guild export', () => {
        expect(importStringHeaderLabel('!RL1!guild-2of3!QUJD')).toBe('Guild · page 2 of 3');
    });
    it('counts several pasted pages', () => {
        expect(importStringHeaderLabel('!RL1!guild-1of3!QUJD\n!RL1!guild-2of3!QUJD')).toBe('Guild · 2 of 3 pages');
    });
    it('returns null for text that is not an import string', () => {
        expect(importStringHeaderLabel('hello world')).toBeNull();
        expect(importStringHeaderLabel('')).toBeNull();
    });
});

describe('size helpers', () => {
    it('formats bytes as KB with one decimal', () => {
        expect(formatKb(12_698)).toBe('12.4 KB');
        expect(formatKb(ADDON_IMPORT_MAX_BYTES)).toBe('256 KB');
    });
    it('measures the trimmed UTF-8 length', () => {
        expect(importStringBytes('  ab  ')).toBe(2);
        expect(importStringBytes('é')).toBe(2);
    });
    it('sends a string at the cap and refuses one byte over', () => {
        const atCap = 'A'.repeat(ADDON_IMPORT_MAX_BYTES);
        expect(sendableImportString(` ${atCap} `)).toBe(atCap);
        expect(sendableImportString(`${atCap}A`)).toBeNull();
        expect(sendableImportString('   ')).toBeNull();
    });
});

describe('canApplyAddonImport', () => {
    const guid = charResult({ warnings: [{ code: 'GUID_CHANGED' }] });
    it('requires repinGuid when the GUID changed', () => {
        expect(canApplyAddonImport(guid, {})).toBe(false);
        expect(canApplyAddonImport(guid, { repinGuid: false })).toBe(false);
        expect(canApplyAddonImport(guid, { repinGuid: true })).toBe(true);
    });
    it('does not require the optional ruleset confirm', () => {
        expect(canApplyAddonImport(charResult({ warnings: [{ code: 'RULESET_CHANGED', from: 'normal', to: 'pvp' }] }), {})).toBe(true);
    });
    it('has nothing to apply for noop and stale previews', () => {
        expect(canApplyAddonImport(charResult({ status: 'noop' }), {})).toBe(false);
        expect(canApplyAddonImport(charResult({ status: 'stale' }), {})).toBe(false);
    });
});

describe('summary copy', () => {
    it('builds char rows with the rounded average item level', () => {
        expect(summaryRows(charResult())).toEqual([['Gear', '17 items · avg ilvl 61'], ['Talents', '31 nodes'], ['Lockouts', '2']]);
    });
    it('ROK-2148 Q8: adds a Guild contributions row for an applied Mailworthy block', () => {
        const summary = { gearCount: 17, avgIlvl: 61.4, talentNodes: 31, lockouts: 2,
            mailworthy: { status: 'applied' as const, givers: 3, giversRejected: 1, peers: 6, template: 'stored' as const } };
        expect(summaryRows(charResult({ status: 'applied', summary }))).toContainEqual(['Guild contributions', 'Updated 3 givers · 1 not on the roster']);
    });
    it('ROK-2148 Q8: names the skip reason, and shows no row without a block', () => {
        expect(mailworthyRow({ status: 'skipped', reason: 'not_on_roster' }))
            .toEqual(['Guild contributions', "Skipped — you're not on the latest guild roster"]);
        expect(mailworthyRow({ status: 'applied', givers: 1, giversRejected: 0, peers: 1, template: 'none' }))
            .toEqual(['Guild contributions', 'Updated 1 giver']);
        expect(summaryRows(charResult()).map(([label]) => label)).not.toContain('Guild contributions');
    });
    it('omits the average when no gear carried an item level', () => {
        expect(summaryRows(charResult({ summary: { gearCount: 0, avgIlvl: null, talentNodes: 0, lockouts: 0 } }))[0]).toEqual(['Gear', '0 items']);
    });
    it('builds guild and raid rows', () => {
        const guild: AddonImportResultDto = { section: 'guild', status: 'preview', exportedAt: EXPORTED_AT, warnings: [], diff: {},
            summary: { guildName: 'Night Watch', members: 40, newMembers: 3, updatedMembers: 37, pages: 2 } };
        expect(summaryRows(guild)).toContainEqual(['Members', '40 (3 new, 37 updated)']);
        const raid: AddonImportResultDto = { section: 'raid', status: 'preview', exportedAt: EXPORTED_AT, warnings: [], diff: {},
            summary: { pulls: 5, newPulls: 4, duplicatePulls: 1, kills: 3, wipes: 2 } };
        expect(summaryRows(raid)).toEqual([['Pulls', '5 (4 new, 1 already imported)'], ['Kills / wipes', '3 / 2']]);
    });
    it('shows class and level changes', () => {
        expect(diffRows(charResult({ diff: { class: { from: null, to: 'Paladin' }, level: { from: 58, to: 60 } } })))
            .toEqual([['Class', '— → Paladin'], ['Level', '58 → 60']]);
    });
    it('formats the provenance line', () => {
        expect(provenanceLine(EXPORTED_AT)).toBe('via addon · self-reported · 4 Oct 2026');
    });
    it('words the result headline per status', () => {
        expect(resultHeadline(charResult({ status: 'applied' }))).toBe('Character data imported.');
        expect(resultHeadline(charResult({ status: 'noop' }))).toMatch(/already up to date/);
    });
    it('ROK-2148: a stale char export whose Mailworthy block applied says the guild contributions updated', () => {
        const applied = { status: 'applied' as const, givers: 2, giversRejected: 0, peers: 2, template: 'none' as const };
        const summary = { gearCount: 17, avgIlvl: 61.4, talentNodes: 31, lockouts: 2, mailworthy: applied };
        expect(resultHeadline(charResult({ status: 'stale', summary })))
            .toBe('Guild contributions updated. Character data not imported — a newer export is already saved.');
        const skipped = { ...summary, mailworthy: { status: 'skipped' as const, reason: 'not_on_roster' as const } };
        expect(resultHeadline(charResult({ status: 'stale', summary: skipped })))
            .toBe('Character data not imported — a newer export is already saved.');
        expect(resultHeadline(charResult({ status: 'stale' }))).toBe('Character data not imported — a newer export is already saved.');
    });
});
