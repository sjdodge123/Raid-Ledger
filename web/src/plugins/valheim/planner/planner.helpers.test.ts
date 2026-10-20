/** ROK-1854 — Planner helpers: tree folding, target serialisation, chips, storage guard. */
import { describe, expect, it } from 'vitest';
import type { ValheimPlanNode } from '@raid-ledger/contract';
import { recipeTreeFixture } from '../../../test/mocks/valheim-recipes-handlers';
import {
    foldNodes,
    formatAmount,
    formatSeconds,
    havePct,
    parseStoredTargets,
    serializeTargets,
    shoppingListText,
    stockAgeLabel,
    viaChips,
} from './planner.helpers';

const station = (p: string) => (p === 'forge' ? 'Forge' : p);
const node = (over: Partial<ValheimPlanNode>): ValheimPlanNode => ({
    id: 0, parentId: null, prefab: 'Wood', quantity: 1, via: { type: 'gathered' },
    alternatives: 0, crafts: 0, have: null, short: null, ...over,
});

describe('foldNodes', () => {
    it('rebuilds the Iron sword branch from parentId links', () => {
        const [root, ...rest] = foldNodes(recipeTreeFixture('SwordIron', 1).nodes);
        expect(rest).toEqual([]);
        expect(root?.node.prefab).toBe('SwordIron');
        expect(root?.children.map((c) => c.node.prefab)).toEqual(['Iron', 'Wood', 'LeatherScraps']);
        expect(root?.children[0]?.children.map((c) => c.node.prefab)).toEqual(['IronScrap', 'Coal']);
    });
    it('treats a node whose parent is missing as a root', () => {
        expect(foldNodes([node({ id: 3, parentId: 99 })]).map((r) => r.node.id)).toEqual([3]);
    });
});

describe('formatting', () => {
    it('serialises targets as prefab:quality:amount', () => {
        expect(serializeTargets([
            { prefab: 'SwordIron', kind: 'item', quality: 2, amount: 3 },
            { prefab: 'piece_chest', kind: 'piece', quality: 1, amount: 1 },
        ])).toBe('SwordIron:2:3,piece_chest:1:1');
    });
    it('renders null as an em dash and groups thousands', () => {
        expect(formatAmount(null)).toBe('—');
        expect(formatAmount(12000)).toBe('12,000');
    });
    it('formats seconds, minutes and hours', () => {
        expect([formatSeconds(30), formatSeconds(2400), formatSeconds(7200)]).toEqual(['30 s', '40 min', '2 h']);
    });
    it('caps the meter at 100 and treats need 0 as full', () => {
        expect([havePct(5, 10), havePct(30, 10), havePct(0, 0)]).toEqual([50, 100, 100]);
    });
    it('labels the stock age', () => {
        const now = Date.parse('2026-10-20T12:00:00Z');
        expect(stockAgeLabel('2026-10-20T11:53:00Z', now)).toBe('Chests scanned 7 min ago');
    });
    it('copies what is still short, else the need', () => {
        const lines = [{ prefab: 'Wood', need: 10, have: 4, short: 6 }, { prefab: 'Coal', need: 3, have: null, short: null }];
        expect(shoppingListText(lines, (p) => p)).toBe('Wood: 6\nCoal: 3');
    });
});

describe('viaChips', () => {
    it('names the station and level, upgrade station and custom formula', () => {
        const via = { type: 'recipe', recipeId: 'r', station: 'forge', stationLevel: 3, quality: 3, upgradeOnly: false, formula: 'custom', anyOneOf: false, upgraderStation: true } as const;
        expect(viaChips(node({ via, alternatives: 2 }), station)).toEqual(['Forge · lvl 3', 'Upgrade station', 'Cost may differ in game', '+2 other ways']);
    });
    it('labels processes, cycles and gathered leaves', () => {
        const proc = { type: 'process', processor: 'fermenter', processorType: 'fermenter', seconds: 2400, windPowered: false, fuel: null } as const;
        expect(viaChips(node({ via: proc }), station)).toEqual(['Fermenter · 40 min']);
        expect(viaChips(node({ via: { type: 'cycle' } }), station)).toEqual(['Loops back']);
        expect(viaChips(node({}), station)).toEqual(['Gathered']);
    });
});

describe('parseStoredTargets', () => {
    it('reads a valid list', () => {
        const list = [{ prefab: 'Club', kind: 'item', quality: 2, amount: 4 }];
        expect(parseStoredTargets(JSON.stringify(list))).toEqual(list);
    });
    it('drops unparseable or off-schema storage', () => {
        expect(parseStoredTargets(null)).toEqual([]);
        expect(parseStoredTargets('{nope')).toEqual([]);
        expect(parseStoredTargets(JSON.stringify([{ prefab: 'Club', kind: 'item', quality: 11, amount: 1 }]))).toEqual([]);
    });
});
