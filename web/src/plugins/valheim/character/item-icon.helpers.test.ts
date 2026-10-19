import { describe, expect, it } from 'vitest';
import type { ValheimItemStack, ValheimMapBaseMap } from '@raid-ledger/contract';
import {
    durabilityPct, itemAriaLabel, itemInitials, resolveItem, spriteGeometry, valheimWikiUrl,
    type ValheimItemCatalogue,
} from './item-icon.helpers';

const SHA = 'a'.repeat(64);
const ATLAS: ValheimMapBaseMap = { sha256: SHA, width: 512, height: 256, ready: true };
const ITEMS: ValheimItemCatalogue = {
    SwordIron: { name: 'Iron sword', category: 'Weapon', icon: { kind: 'atlas', x: 64, y: 32, w: 64, h: 64 } },
    TrophyBoar: { name: 'Boar trophy', category: 'Trophy', icon: { kind: 'file', sha256: SHA } },
    Resin: { name: 'Resin', category: '', icon: null },
};
const stack = (over: Partial<ValheimItemStack> = {}): ValheimItemStack => ({
    prefab: 'SwordIron', stack: 1, quality: 1, variant: 0, durability: null, maxDurability: null, ...over,
});

describe('resolveItem — D7 fallback ladder', () => {
    it('catalogue hit with a drawable atlas icon → icon', () => {
        expect(resolveItem('SwordIron', ITEMS, ATLAS)).toEqual({
            label: 'Iron sword', category: 'Weapon', kind: 'icon', icon: { kind: 'atlas', x: 64, y: 32, w: 64, h: 64 },
        });
    });
    it('a file icon is drawable without any atlas', () => {
        expect(resolveItem('TrophyBoar', ITEMS, null).kind).toBe('icon');
    });
    it('atlas icon but the atlas blob is not ready → initials tile, name kept', () => {
        const r = resolveItem('SwordIron', ITEMS, { ...ATLAS, ready: false });
        expect(r).toMatchObject({ label: 'Iron sword', kind: 'initials', icon: null });
    });
    it('atlas icon but no atlas at all → initials tile', () => {
        expect(resolveItem('SwordIron', ITEMS, undefined).kind).toBe('initials');
    });
    it('catalogue entry without an icon → initials, empty category → null', () => {
        expect(resolveItem('Resin', ITEMS, ATLAS)).toEqual({ label: 'Resin', category: null, kind: 'initials', icon: null });
    });
    it('prefab not in the catalogue → its id as the label, unknown tile', () => {
        expect(resolveItem('ModdedAxe', ITEMS, ATLAS)).toEqual({ label: 'ModdedAxe', category: null, kind: 'unknown', icon: null });
    });
    it('no catalogue at all (items undefined or {}) → unknown, never throws', () => {
        expect(resolveItem('SwordIron', undefined, null).kind).toBe('unknown');
        expect(resolveItem('SwordIron', {}, ATLAS).kind).toBe('unknown');
    });
});

describe('item helpers', () => {
    it('itemInitials takes up to two word initials', () => {
        expect(itemInitials('Iron sword')).toBe('IS');
        expect(itemInitials('Resin')).toBe('R');
        expect(itemInitials('The Elder trophy')).toBe('TE');
    });
    it('spriteGeometry scales the cell to the box and offsets by its position', () => {
        expect(spriteGeometry({ x: 64, y: 32, w: 64, h: 64 }, ATLAS, 32)).toEqual({
            backgroundPosition: '-32px -16px', backgroundSize: '256px 128px', width: 32, height: 32,
        });
    });
    it('valheimWikiUrl underscores spaces and URL-encodes the name', () => {
        expect(valheimWikiUrl('Iron sword')).toBe('https://valheim.weirdgloop.org/w/Iron_sword');
        expect(valheimWikiUrl("Bonemass's trophy/2")).toBe('https://valheim.weirdgloop.org/w/Bonemass\'s_trophy%2F2');
    });
    it('durabilityPct is null without durability and clamps otherwise', () => {
        expect(durabilityPct(stack())).toBeNull();
        expect(durabilityPct(stack({ durability: 50, maxDurability: 200 }))).toBe(25);
        expect(durabilityPct(stack({ durability: 5, maxDurability: 0 }))).toBeNull();
    });
    it('itemAriaLabel names stack, quality and equipped only when they matter', () => {
        expect(itemAriaLabel('Iron sword', stack(), false)).toBe('Iron sword');
        expect(itemAriaLabel('Resin', stack({ stack: 30, quality: 3 }), true)).toBe('Resin, 30, quality 3, equipped');
    });
});
