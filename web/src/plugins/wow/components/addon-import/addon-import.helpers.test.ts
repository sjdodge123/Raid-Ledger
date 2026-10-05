import { describe, it, expect } from 'vitest';
import { ADDON_IMPORT_MAX_BYTES, type AddonImportResultDto } from '@raid-ledger/contract';
import {
    canApplyAddonImport, diffRows, formatKb, importStringBytes, importStringHeaderLabel,
    provenanceLine, resultHeadline, sendableImportString, summaryRows,
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
});
