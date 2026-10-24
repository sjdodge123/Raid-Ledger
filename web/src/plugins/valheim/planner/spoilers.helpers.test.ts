/** ROK-1948 — spoiler-protection helpers: withheld nodes get no chips, hidden stored targets, station labels never a raw prefab. */
import { describe, expect, it } from 'vitest';
import type { ValheimPlanNode } from '@raid-ledger/contract';
import { recipeCatalogFixture, recipeCatalogProtectedFixture } from '../../../test/mocks/valheim-recipes-handlers';
import { stationGroups } from './crafting.helpers';
import { viaChips } from './planner.helpers';
import { isHiddenTarget, isUndiscoveredNode, planHasUndiscovered } from './spoilers.helpers';

const node = (via: ValheimPlanNode['via'], alternatives = 0): ValheimPlanNode => ({
    id: 1, parentId: 0, prefab: 'Bronze', quantity: 2, alternatives, crafts: 0, have: 0, short: 2, via,
});
const stationName = (p: string): string => p;

describe('viaChips on a withheld node', () => {
    it('undiscovered → no chips: no "Gathered", no "+N other ways"', () => {
        expect(viaChips(node({ type: 'undiscovered' }, 3), stationName)).toEqual([]);
    });
    it('a via this bundle does not know (stale tab, W6) is treated as undiscovered, never "Gathered"', () => {
        const unknown = { type: 'from-the-future' } as unknown as ValheimPlanNode['via'];
        expect(isUndiscoveredNode({ via: unknown })).toBe(true);
        expect(viaChips(node(unknown, 2), stationName)).toEqual([]);
    });
    it('a gathered node keeps its chip and its "+N" count', () => {
        expect(viaChips(node({ type: 'gathered' }, 2), stationName)).toEqual(['Gathered', '+2 other ways']);
        expect(isUndiscoveredNode({ via: { type: 'gathered' } })).toBe(false);
    });
    it('planHasUndiscovered spots one withheld node among visible ones', () => {
        expect(planHasUndiscovered([{ via: { type: 'gathered' } }, { via: { type: 'undiscovered' } }])).toBe(true);
        expect(planHasUndiscovered([{ via: { type: 'gathered' } }, { via: { type: 'fuel' } }])).toBe(false);
    });
});

describe('isHiddenTarget', () => {
    const protectedCatalog = recipeCatalogProtectedFixture();
    it('a stored target missing from the protected catalogue is hidden', () => {
        expect(isHiddenTarget(protectedCatalog, { prefab: 'SwordIron', kind: 'item' })).toBe(true);
    });
    it('a visible target is not hidden; the kind must match too', () => {
        expect(isHiddenTarget(protectedCatalog, { prefab: 'Club', kind: 'item' })).toBe(false);
        expect(isHiddenTarget(protectedCatalog, { prefab: 'Club', kind: 'piece' })).toBe(true);
    });
    it('nothing is hidden while protection is off or the status is absent', () => {
        const missing = { prefab: 'SwordBronze', kind: 'item' } as const;
        expect(isHiddenTarget(recipeCatalogFixture({ spoilers: 'off-no-data' }), missing)).toBe(false);
        expect(isHiddenTarget(recipeCatalogFixture({ spoilers: 'off-truncated' }), missing)).toBe(false);
        expect(isHiddenTarget(recipeCatalogFixture(), missing)).toBe(false);
    });
});

describe('stationGroups on a protected catalogue', () => {
    it('every row’s station is in `stations`, so no group label is a raw station prefab', () => {
        const c = recipeCatalogProtectedFixture();
        const prefabs = new Set(c.stations.map((s) => s.prefab));
        const groups = stationGroups(c.entries, c.stations, 'craft', { kind: 'both', category: null });
        expect(groups.map((g) => g.label)).toEqual(['Workbench']);
        expect(groups.filter((g) => prefabs.has(g.label) || g.label === 'forge')).toEqual([]);
    });
});
