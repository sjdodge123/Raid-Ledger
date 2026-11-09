/** ROK-2147 — `matchInstalled`: recommendation folder name ↔ installed folder, case-insensitive. */
import { describe, it, expect } from 'vitest';
import type { CharacterInstalledAddon } from '@raid-ledger/contract';
import type { AddonView } from '../guild/addon-view';
import { matchInstalled } from './installed-addons.helpers';

function rec(name: string, folderName: string | null, required = false): AddonView {
    return { key: `g-${name}`, id: 1, name, url: 'https://example.test', note: null, required, source: 'GitHub', flavorLabel: 'Any flavor', folderName };
}

function inst(name: string, loaded = true): CharacterInstalledAddon {
    return { name, title: null, version: null, loaded };
}

describe('matchInstalled', () => {
    it('marks a recommendation installed when its folder is present, ignoring case', () => {
        const { rows } = matchInstalled([rec('LedgerLink', 'ledgerlink')], [inst('LedgerLink')]);
        expect(rows.map((r) => r.state)).toEqual(['installed']);
    });

    it('marks a recommendation missing when its folder is absent', () => {
        const { rows } = matchInstalled([rec('DBM', 'DBM-Core', true)], [inst('Questie')]);
        expect(rows.map((r) => r.state)).toEqual(['missing']);
    });

    it('gives a recommendation without a folder name no state, even when a same-named folder is installed', () => {
        const { rows, others } = matchInstalled([rec('Questie', null)], [inst('Questie')]);
        expect(rows.map((r) => r.state)).toEqual([null]);
        expect(others.map((o) => o.name), 'an unclaimed folder stays in Also installed').toEqual(['Questie']);
    });

    it('keeps the recommendation order', () => {
        const { rows } = matchInstalled([rec('B', 'b'), rec('A', 'a')], [inst('a'), inst('b')]);
        expect(rows.map((r) => r.addon.name)).toEqual(['B', 'A']);
    });

    it('lists unclaimed folders loaded first, then by name', () => {
        const installed = [inst('zeta'), inst('Alpha', false), inst('beta'), inst('LedgerLink')];
        const { others } = matchInstalled([rec('LedgerLink', 'LEDGERLINK')], installed);
        expect(others.map((o) => o.name)).toEqual(['beta', 'zeta', 'Alpha']);
    });

    it('returns nothing extra for an empty installed list', () => {
        const { rows, others } = matchInstalled([rec('DBM', 'DBM-Core')], []);
        expect(rows.map((r) => r.state)).toEqual(['missing']);
        expect(others).toEqual([]);
    });
});
