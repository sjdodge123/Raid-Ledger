import { describe, expect, it } from 'vitest';
import { questRewardAsLoot } from './quest-reward-loot';
import { REWARD_LEGS, tooltip } from '../components/item-compare-row.fixtures';
import { compareTarget } from './item-compare-slots';

describe('questRewardAsLoot slot (ROK-2186, Codex P2)', () => {
    it('maps the reward slot onto the loot slot name', () => {
        expect(questRewardAsLoot(REWARD_LEGS, 'classic').slot).toBe('Legs');
    });

    it('a metadata-only reward (slot null) falls back to the tooltip slot, so it gets a compare target', () => {
        const metaOnly = { ...REWARD_LEGS, slot: null, tooltip: tooltip({ slotLabel: 'Two-Hand' }) };
        const loot = questRewardAsLoot(metaOnly, 'classic');
        expect(loot.slot).toBe('Two-Hand');
        expect(compareTarget(loot.slot, new Map()).mode).not.toBe('none');
    });

    it('no reward slot and no tooltip → null', () => {
        expect(questRewardAsLoot({ ...REWARD_LEGS, slot: null, tooltip: null }, 'classic').slot).toBeNull();
    });
});
