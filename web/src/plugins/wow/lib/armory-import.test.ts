import { describe, it, expect } from 'vitest';
import { isArmoryImportSupported, ARMORY_CLASSIC_VARIANTS } from './armory-import';

describe('isArmoryImportSupported (ROK-1636)', () => {
    it('rejects wow_forever — Blizzard has no Forever profile API yet', () => {
        expect(isArmoryImportSupported('wow_forever')).toBe(false);
    });

    it.each(['retail', 'classic_era', 'classic_anniversary', 'classic'])('supports %s', (variant) => {
        expect(isArmoryImportSupported(variant)).toBe(true);
    });

    it('treats a missing variant as retail (supported)', () => {
        expect(isArmoryImportSupported(undefined)).toBe(true);
        expect(isArmoryImportSupported(null)).toBe(true);
    });

    it('keeps Forever out of the Armory Game Version pickers', () => {
        expect(ARMORY_CLASSIC_VARIANTS.map((v) => v.value)).toEqual(['classic_anniversary', 'classic_era', 'classic']);
    });
});
