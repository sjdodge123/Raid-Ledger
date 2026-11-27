/**
 * ROK-2352 — the WoW grouping names groups in core UI ("Your hand" card)
 * through the `groupLabel` seam, never a hardcoded game check in core.
 */
import { describe, expect, it } from 'vitest';
import { wowLfgGrouping } from './wow-lfg-grouping';
import { WOW_LFG_COPY } from './wow-lfg-copy';

describe('wowLfgGrouping.groupLabel', () => {
    it('names the whole-game group "Any dungeon" and keeps the adapter label otherwise', () => {
        const label = wowLfgGrouping.groupLabel;
        expect(label?.({ groupKey: '', groupLabel: null })).toBe(WOW_LFG_COPY.anyLabel);
        expect(label?.({ groupKey: 'raid:409', groupLabel: 'Molten Core' })).toBe('Molten Core');
    });
});
