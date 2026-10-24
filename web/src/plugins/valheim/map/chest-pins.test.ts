import { describe, expect, it } from 'vitest';
import type { ValheimContainerSummary } from '@raid-ledger/contract';
import { chestCart, chestShared } from '../../../test/mocks/valheim-materials-handlers';
import { CHEST_PIN_TYPE, chestAsMapPin, filterChests } from './chest-pins';
import { DEFAULT_PIN_FILTER, type PinFilter } from './pin-filter';
import { pinAccessibleName, pinStyleFor } from './pin-types';

const NAMES: Record<string, string> = { [chestShared.key]: 'Wood chest 2 · Base near x 3, z 53', [chestCart.key]: 'Cart 1 · Away from bases' };
const nameOf = (c: ValheimContainerSummary): string => NAMES[c.key] ?? 'unnamed';
const filter = (over: Partial<PinFilter> = {}): PinFilter => ({ ...DEFAULT_PIN_FILTER, ...over });
const CHESTS = [chestShared, chestCart];

describe('chest pins (ROK-1859 D12)', () => {
    it('a chest is a reserved-type pin at its x/z, never shared or crossed, named "<display name> (Chest)"', () => {
        const pin = chestAsMapPin(chestShared, 'Wood chest 2 · Base near x 3, z 53');
        expect(pin).toEqual({
            type: 'rl:chest', label: 'Wood chest 2 · Base near x 3, z 53',
            x: 120, z: -340, checked: false, shared: false,
        });
        expect(pinAccessibleName(pin)).toBe('Wood chest 2 · Base near x 3, z 53 (Chest)');
        expect(CHEST_PIN_TYPE).toBe('rl:chest');
    });

    it('the rl:chest style is a warning ArchiveBox on a warning ring', () => {
        const s = pinStyleFor(CHEST_PIN_TYPE);
        expect([s.typeLabel, s.iconName, s.toneClass, s.ring, s.ringTone])
            .toEqual(['Chest', 'archive-box', 'text-warning', true, 'border-warning']);
    });

    it('every chip (types null) keeps every chest; pins and chests stay index-aligned', () => {
        const kept = filterChests(CHESTS, filter(), nameOf);
        expect(kept.chests.map((c) => c.key)).toEqual([chestShared.key, chestCart.key]);
        expect(kept.pins.map((p) => p.label)).toEqual(['Wood chest 2 · Base near x 3, z 53', 'Cart 1 · Away from bases']);
    });

    it('the Chests chip gates the layer: picked → kept, not picked → none', () => {
        expect(filterChests(CHESTS, filter({ types: new Set(['chest']) }), nameOf).pins).toHaveLength(2);
        expect(filterChests(CHESTS, filter({ types: new Set(['death', 'scanned-portal']) }), nameOf)).toEqual({ pins: [], chests: [] });
    });

    it('the label search runs on the display name; hide crossed-out never hides a chest', () => {
        const kept = filterChests(CHESTS, filter({ query: 'away from', hideCrossed: true }), nameOf);
        expect(kept.chests.map((c) => c.key)).toEqual([chestCart.key]);
        expect(filterChests(CHESTS, filter({ query: 'base near x 3' }), nameOf).chests.map((c) => c.key)).toEqual([chestShared.key]);
    });
});
