import { describe, expect, it } from 'vitest';
import type { LfgGroupListItemDto } from '@raid-ledger/contract';
import { isFullGroup, orderWowLfgGroups } from './wow-lfg-group-order';

function item(over: Partial<LfgGroupListItemDto>): LfgGroupListItemDto {
    return {
        gameId: 1, gameName: 'WoW', gameSlug: 'world-of-warcraft', gameCoverUrl: null,
        activeCount: 0, nowCount: 0, state: null, viabilityThreshold: null, isViable: false,
        hasOwnIntent: false, soonestExpiresAt: null, soonestNowExpiresAt: null, playingNow: null,
        groupKey: '', groupLabel: null, ...over,
    };
}

const shape = { tank: 1, healer: 1, dps: 3 };

describe('isFullGroup', () => {
    it('is true only when coverage meets every role of the shape', () => {
        expect(isFullGroup(item({ rosterShape: shape, coverage: { tank: 1, healer: 1, dps: 3 } }))).toBe(true);
        expect(isFullGroup(item({ rosterShape: shape, coverage: { tank: 1, healer: 0, dps: 3 } }))).toBe(false);
        expect(isFullGroup(item({ rosterShape: shape }))).toBe(false);
    });
});

describe('orderWowLfgGroups', () => {
    it('puts Any first and splits dungeons from raids, Full then by size', () => {
        const groups = [
            item({ groupKey: 'dungeon:2', groupLabel: 'Stockades', kind: 'dungeon', activeCount: 1 }),
            item({ groupKey: 'raid:9', groupLabel: 'Molten Core', kind: 'raid', activeCount: 4 }),
            item({ groupKey: '', kind: 'any', activeCount: 2 }),
            item({ groupKey: 'dungeon:3', groupLabel: 'Deadmines', kind: 'dungeon', activeCount: 3 }),
            item({ groupKey: 'dungeon:4', groupLabel: 'Wailing', kind: 'dungeon', activeCount: 5,
                rosterShape: shape, coverage: shape }),
        ];
        const out = orderWowLfgGroups(groups);
        expect(out.any?.groupKey).toBe('');
        expect(out.dungeons.map((g) => g.groupKey)).toEqual(['dungeon:4', 'dungeon:3', 'dungeon:2']);
        expect(out.raids.map((g) => g.groupKey)).toEqual(['raid:9']);
    });

    it('breaks a size tie by label so the order is stable', () => {
        const out = orderWowLfgGroups([
            item({ groupKey: 'dungeon:2', groupLabel: 'Stockades', kind: 'dungeon' }),
            item({ groupKey: 'dungeon:3', groupLabel: 'Deadmines', kind: 'dungeon' }),
        ]);
        expect(out.dungeons.map((g) => g.groupLabel)).toEqual(['Deadmines', 'Stockades']);
        expect(out.any).toBeNull();
    });
});
