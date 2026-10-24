import { describe, expect, it } from 'vitest';
import type { ValheimServerPortal } from '@raid-ledger/contract';
import { DEFAULT_PIN_FILTER, type PinFilter } from './pin-filter';
import type { PinTypeGroupId } from './pin-type-groups';
import { SCANNED_PORTAL_TYPE, filterPortals, portalAsMapPin, portalLabel } from './portal-pins';

const portal = (tag: string, x = 0): ValheimServerPortal => ({ prefab: 'portal_wood', x, y: null, z: 0, tag });
const PORTALS = [portal('swamp', 1), portal('  ', 2), portal('home', 3)];
const f = (over: Partial<PinFilter>): PinFilter => ({ ...DEFAULT_PIN_FILTER, ...over });
const labels = (filter: PinFilter) => filterPortals(PORTALS, filter).map((p) => p.label);
const types = (...ids: PinTypeGroupId[]) => new Set(ids);

describe('scanned portals as pins (ROK-1946 D10/D14)', () => {
    it('an empty or whitespace tag is "Unnamed portal"; any other tag is kept, trimmed', () => {
        expect(portalLabel('')).toBe('Unnamed portal');
        expect(portalLabel('   ')).toBe('Unnamed portal');
        expect(portalLabel('Swamp base')).toBe('Swamp base');
        expect(portalLabel(' home ')).toBe('home');
    });

    it('portalAsMapPin is the reserved type, never shared, never crossed', () => {
        expect(portalAsMapPin(portal('home', 7))).toEqual({
            type: SCANNED_PORTAL_TYPE, label: 'home', x: 7, z: 0, checked: false, shared: false,
        });
        expect(SCANNED_PORTAL_TYPE).toBe('rl:scanned-portal');
    });
});

describe('filterPortals (ROK-1946 D12)', () => {
    it('every type (null) shows all; a pick without Scanned portals shows none', () => {
        expect(labels(f({}))).toEqual(['swamp', 'Unnamed portal', 'home']);
        expect(labels(f({ types: types('portal', 'death') }))).toEqual([]);
        expect(labels(f({ types: types('scanned-portal') }))).toHaveLength(3);
    });

    it('search is a case-insensitive substring of the display label', () => {
        expect(labels(f({ query: 'SWA' }))).toEqual(['swamp']);
        expect(labels(f({ query: 'unnamed' }))).toEqual(['Unnamed portal']);
    });

    it('hide crossed-out never hides a portal', () => {
        expect(labels(f({ hideCrossed: true }))).toHaveLength(3);
    });

    it('"Whose pins" does not apply: this character, everyone and chosen players all show them', () => {
        for (const players of ['character', 'all', [3]] as const) {
            expect(labels(f({ players }))).toHaveLength(3);
        }
    });
});
