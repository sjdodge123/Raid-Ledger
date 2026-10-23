import { describe, expect, it } from 'vitest';
import type { ValheimDeathPin, ValheimMapPin } from '@raid-ledger/contract';
import { deathsMapHref, deathsShowAllHref } from '../hub/valheim-deaths.helpers';
import { filterPins, parsePinFilter, writePinFilter, writeSelection } from './pin-filter';

const qs = (s: string) => new URLSearchParams(s);
const own = (type: string, label: string): ValheimMapPin =>
    ({ type, label, x: 0, z: 0, checked: false, shared: false });
const server: ValheimDeathPin[] = [
    { x: 1, z: 2, characterId: 11, characterName: 'Ragnhild', type: 'Death' },
];

describe('parsePinFilter (ROK-1930 D10/D13)', () => {
    it('reads the widget deep links: a bar = this character, Show all = the server layer', () => {
        expect(parsePinFilter(qs(deathsMapHref({ characterId: 5 })?.split('#')[0] ?? ''))).toEqual(
            { deathsOnly: true, scope: 'character' });
        expect(parsePinFilter(qs(deathsShowAllHref().split('#')[0] ?? ''))).toEqual(
            { deathsOnly: true, scope: 'server' });
    });

    it('ignores an absent or unknown pins value', () => {
        expect(parsePinFilter(qs('vc=5'))).toEqual({ deathsOnly: false });
        expect(parsePinFilter(qs('pins=bed&vc=5'))).toEqual({ deathsOnly: false });
    });
});

describe('writePinFilter', () => {
    it('ON keeps the other params and pins the shown character; OFF drops only pins', () => {
        const on = writePinFilter(qs('vm=9&x=1'), true, 5);
        expect(on.toString()).toBe('vm=9&x=1&pins=death&vc=5');
        expect(parsePinFilter(on)).toEqual({ deathsOnly: true, scope: 'character' });
        expect(writePinFilter(on, false, 5).toString()).toBe('vm=9&x=1&vc=5');
    });

    it('ON never replaces a vc already in the URL', () => {
        expect(writePinFilter(qs('vc=8'), true, 5).get('vc')).toBe('8');
    });
});

describe('filterPins', () => {
    const pins = [own('Bed', 'Home'), own('Death', 'Grave')];

    it('unfiltered = every own pin; character scope = own Death pins only', () => {
        expect(filterPins(pins, { deathsOnly: false }, server)).toBe(pins);
        expect(filterPins(pins, { deathsOnly: true, scope: 'character' }, server).map((p) => p.label))
            .toEqual(['Grave']);
    });

    it('server scope = the server layer as Death pins labelled by character, empty until loaded', () => {
        expect(filterPins(pins, { deathsOnly: true, scope: 'server' }, server)).toEqual([
            { type: 'Death', label: 'Ragnhild', x: 1, z: 2, checked: false, shared: false },
        ]);
        expect(filterPins(pins, { deathsOnly: true, scope: 'server' }, undefined)).toEqual([]);
    });
});

describe('writeSelection (review fix: Show all scope stays explicit)', () => {
    it('a world pick in Show all stays Show all — only vm changes', () => {
        const next = writeSelection(qs('pins=death&vm=3'), { characterId: 5, mapId: 9, world: true });
        expect(next.toString()).toBe('pins=death&vm=9');
        expect(parsePinFilter(next)).toEqual({ deathsOnly: true, scope: 'server' });
    });

    it("a character pick in Show all is explicit: vc lands in the URL and the scope is that character's", () => {
        const next = writeSelection(qs('pins=death&vm=3'), { characterId: 8, mapId: null, world: false });
        expect(next.toString()).toBe('pins=death&vc=8');
        expect(parsePinFilter(next)).toEqual({ deathsOnly: true, scope: 'character' });
    });

    it('outside Show all a world pick still pins the shown character', () => {
        expect(writeSelection(qs('vm=3'), { characterId: 5, mapId: 9, world: true }).toString())
            .toBe('vm=9&vc=5');
        expect(writeSelection(qs('pins=death&vc=5'), { characterId: 5, mapId: 9, world: true }).toString())
            .toBe('pins=death&vc=5&vm=9');
    });
});
