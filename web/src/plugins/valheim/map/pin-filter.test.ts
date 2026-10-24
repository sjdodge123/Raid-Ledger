import { describe, expect, it } from 'vitest';
import type { ValheimMapPin, ValheimServerPin } from '@raid-ledger/contract';
import { deathsMapHref, deathsShowAllHref } from '../hub/valheim-deaths.helpers';
import {
    DEFAULT_PIN_FILTER, activeFilterCount, clearPinFilters, filterPins, parsePinFilter,
    serverPinAsMapPin, toggleType, writePinFilter, writeSelection, type PinFilter,
} from './pin-filter';

const qs = (s: string) => new URLSearchParams(s);
const hrefQs = (href: string | null) => qs(href?.split('#')[0] ?? '');
const own = (type: string, label: string, checked = false): ValheimMapPin =>
    ({ type, label, x: 0, z: 0, checked, shared: false });
const serverPin = (type: string, label: string, characterName: string, checked = false): ValheimServerPin =>
    ({ x: 1, z: 2, type, label, checked, characterId: 11, characterName });
const f = (over: Partial<PinFilter>): PinFilter => ({ ...DEFAULT_PIN_FILTER, ...over });
const types = (filter: PinFilter) => (filter.types === null ? null : [...filter.types].sort());

describe('parsePinFilter (ROK-1943 S13 / D9)', () => {
    it('no params = the default filter', () => {
        expect(parsePinFilter(qs('vc=5&vm=9'))).toEqual(DEFAULT_PIN_FILTER);
    });

    it('reads a chip list and drops unknown ids; all unknown = every type', () => {
        expect(types(parsePinFilter(qs('pins=death,portal&vc=5')))).toEqual(['death', 'portal']);
        expect(types(parsePinFilter(qs('pins=death,nope&vc=5')))).toEqual(['death']);
        expect(parsePinFilter(qs('pins=nope&vc=5')).types).toBeNull();
    });

    it('reads players=all and an id list, dropping bad tokens; none valid = this character', () => {
        expect(parsePinFilter(qs('players=all')).players).toBe('all');
        expect(parsePinFilter(qs('players=3,x,5,3,0,-1')).players).toEqual([3, 5]);
        expect(parsePinFilter(qs('players=x,0')).players).toBe('character');
    });

    it('caps a player id list at the server limit (100) so an over-long URL cannot 400', () => {
        const ids = Array.from({ length: 150 }, (_, i) => i + 1);
        const players = parsePinFilter(qs(`players=1,${ids.join(',')}`)).players;
        expect(players, 'first 100 distinct ids').toEqual(ids.slice(0, 100));
    });

    it('trims and caps the search; reads crossed=hide only', () => {
        expect(parsePinFilter(qs('q=%20Base%20')).query).toBe('Base');
        expect(parsePinFilter(qs(`q=${'a'.repeat(80)}`)).query).toHaveLength(64);
        expect(parsePinFilter(qs('crossed=hide')).hideCrossed).toBe(true);
        expect(parsePinFilter(qs('crossed=show')).hideCrossed).toBe(false);
    });

    it('D10: a Deaths bar link = Death, this character; legacy Show all = Death, every player', () => {
        const bar = parsePinFilter(hrefQs(deathsMapHref({ characterId: 7 })));
        expect([types(bar), bar.players]).toEqual([['death'], 'character']);
        const legacy = parsePinFilter(qs('pins=death'));
        expect([types(legacy), legacy.players]).toEqual([['death'], 'all']);
        const showAll = parsePinFilter(hrefQs(deathsShowAllHref()));
        expect([types(showAll), showAll.players]).toEqual([['death'], 'all']);
    });

    it('the new Show all link is explicit', () => {
        expect(deathsShowAllHref()).toBe('?pins=death&players=all#map');
    });
});

describe('writePinFilter / clearPinFilters (S14)', () => {
    it('writes each filter, keeps other params and pins the shown character', () => {
        const next = writePinFilter(qs('vm=9&x=1'), { types: new Set(['portal', 'death'] as const) }, 5);
        expect(next.toString()).toBe('vm=9&x=1&pins=death%2Cportal&vc=5');
        const all = writePinFilter(next, { players: [8, 3, 8], query: ' Base ', hideCrossed: true }, 5);
        expect(all.get('players')).toBe('8,3');
        expect(all.get('q')).toBe('Base');
        expect(all.get('crossed')).toBe('hide');
    });

    it('never replaces a vc already in the URL', () => {
        expect(writePinFilter(qs('vc=8'), { hideCrossed: true }, 5).get('vc')).toBe('8');
    });

    it('D10: toggling a chip from a legacy Show all URL writes players=all and vc', () => {
        const next = writePinFilter(qs('pins=death'), { types: toggleType(new Set(['death'] as const), 'bed') }, 5);
        expect(next.get('players')).toBe('all');
        expect(next.get('vc')).toBe('5');
        expect(parsePinFilter(next).players).toBe('all');
        expect(types(parsePinFilter(next))).toEqual(['bed', 'death']);
    });

    it('default values drop their params', () => {
        const next = writePinFilter(qs('pins=bed&players=all&q=x&crossed=hide&vc=5'),
            { types: null, players: 'character', query: '  ', hideCrossed: false }, 5);
        expect(next.toString()).toBe('vc=5');
    });

    it('Clear all drops the four params and keeps vc/vm', () => {
        expect(clearPinFilters(qs('pins=bed&players=3&q=x&crossed=hide&vc=5&vm=9'), 5).toString())
            .toBe('vc=5&vm=9');
    });
});

describe('toggleType', () => {
    it('from every type selects only that chip; the last chip off = every type', () => {
        const one = toggleType(null, 'portal');
        expect(one === null ? null : [...one]).toEqual(['portal']);
        expect(toggleType(one, 'portal')).toBeNull();
        const two = toggleType(one, 'death');
        expect(two === null ? null : [...two].sort()).toEqual(['death', 'portal']);
    });
});

describe('activeFilterCount (S16)', () => {
    it('counts non-default sections, 0..4', () => {
        expect(activeFilterCount(DEFAULT_PIN_FILTER)).toBe(0);
        expect(activeFilterCount(f({ types: new Set(['bed'] as const), players: 'all', query: 'x', hideCrossed: true })))
            .toBe(4);
        expect(activeFilterCount(f({ players: [3] }))).toBe(1);
    });
});

describe('filterPins (S15)', () => {
    const pins = [own('Bed', 'Home'), own('Death', 'Grave'), own('Icon4', ''), own('Modded_X', 'Odd', true)];
    const labels = (out: readonly ValheimMapPin[]) => out.map((p) => p.label);

    it('no filter = every own pin', () => {
        expect(labels(filterPins(pins, DEFAULT_PIN_FILTER, undefined))).toEqual(['Home', 'Grave', '', 'Odd']);
    });

    it('types keep only the selected groups (Other = unknown types)', () => {
        expect(labels(filterPins(pins, f({ types: new Set(['death', 'other'] as const) }), undefined)))
            .toEqual(['Grave', 'Odd']);
    });

    it('search is case-insensitive on the display label — an unnamed Portal matches "portal"', () => {
        expect(labels(filterPins(pins, f({ query: 'PORTAL' }), undefined))).toEqual(['']);
        expect(labels(filterPins(pins, f({ query: 'gra' }), undefined))).toEqual(['Grave']);
    });

    it('hideCrossed drops checked pins', () => {
        expect(labels(filterPins(pins, f({ hideCrossed: true }), undefined))).toEqual(['Home', 'Grave', '']);
    });

    it('players scope draws the server layer with "<label> · <character>" labels, empty until loaded', () => {
        const layer = [serverPin('Icon4', '', 'Ragnhild'), serverPin('Bed', 'Base', 'Hrafn', true)];
        expect(labels(filterPins(pins, f({ players: 'all' }), layer))).toEqual(['Portal · Ragnhild', 'Base · Hrafn']);
        expect(filterPins(pins, f({ players: [11] }), undefined)).toEqual([]);
    });

    it('search never matches the character suffix (D14)', () => {
        const layer = [serverPin('Bed', 'Base', 'Ragnhild')];
        expect(filterPins(pins, f({ players: 'all', query: 'ragn' }), layer)).toEqual([]);
        expect(filterPins(pins, f({ players: 'all', hideCrossed: true }), [serverPin('Bed', 'B', 'R', true)]))
            .toEqual([]);
    });

    it('serverPinAsMapPin carries checked and is never a cartography copy', () => {
        expect(serverPinAsMapPin(serverPin('Death', '', 'Ragnhild', true))).toEqual(
            { type: 'Death', label: 'Death · Ragnhild', x: 1, z: 2, checked: true, shared: false });
    });
});

describe('writeSelection (S17, Q1 = a)', () => {
    it('a character pick keeps the players choice; only vc changes', () => {
        const next = writeSelection(qs('pins=death&players=all&vc=5&vm=3'), { characterId: 8, mapId: null, world: false });
        expect(next.toString()).toBe('pins=death&players=all&vc=8');
        expect(parsePinFilter(next).players).toBe('all');
    });

    it('a pick from a legacy Show all URL makes the scope explicit before writing vc', () => {
        const next = writeSelection(qs('pins=death&vm=3'), { characterId: 5, mapId: 9, world: true });
        expect(next.toString()).toBe('pins=death&vm=9&players=all&vc=5');
        expect(parsePinFilter(next).players).toBe('all');
    });

    it('outside a players scope both picks write vc as before', () => {
        expect(writeSelection(qs('vm=3'), { characterId: 5, mapId: 9, world: true }).toString()).toBe('vm=9&vc=5');
        expect(writeSelection(qs('pins=death&vc=5'), { characterId: 5, mapId: 9, world: true }).toString())
            .toBe('pins=death&vc=5&vm=9');
    });
});
