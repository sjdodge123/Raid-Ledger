import { describe, it, expect } from 'vitest';
import type { BlizzardCapabilitiesDto } from '@raid-ledger/contract';
import { isArmoryImportSupported, armoryClassicVariants, defaultArmoryClassicVariant } from './armory-import';

const FOREVER_ON: BlizzardCapabilitiesDto = { armoryImport: { wow_forever: true } };
const FOREVER_OFF: BlizzardCapabilitiesDto = { armoryImport: { wow_forever: false } };

describe('isArmoryImportSupported (ROK-1636, runtime caps ROK-1717)', () => {
    it.each([
        ['undefined caps (loading/failed — fail closed)', undefined],
        ['the capability off', FOREVER_OFF],
    ])('rejects wow_forever with %s', (_label, caps) => {
        expect(isArmoryImportSupported('wow_forever', caps)).toBe(false);
        expect(isArmoryImportSupported('classicforever', caps)).toBe(false);
    });

    it('supports wow_forever (and its classicforever alias) once the admin turns the capability on', () => {
        expect(isArmoryImportSupported('wow_forever', FOREVER_ON)).toBe(true);
        expect(isArmoryImportSupported('classicforever', FOREVER_ON)).toBe(true);
    });

    it.each(['retail', 'classic_era', 'classic_anniversary', 'classic'])('supports %s regardless of caps', (variant) => {
        expect(isArmoryImportSupported(variant, undefined)).toBe(true);
        expect(isArmoryImportSupported(variant, FOREVER_OFF)).toBe(true);
    });

    it('treats a missing variant as retail (supported)', () => {
        expect(isArmoryImportSupported(undefined, undefined)).toBe(true);
        expect(isArmoryImportSupported(null, undefined)).toBe(true);
    });
});

describe('armoryClassicVariants (ROK-1717)', () => {
    it('keeps Forever out of the Armory Game Version pickers while the capability is off or unknown', () => {
        expect(armoryClassicVariants(undefined).map((v) => v.value)).toEqual(['classic_anniversary', 'classic_era', 'classic']);
        expect(armoryClassicVariants(FOREVER_OFF).map((v) => v.value)).toEqual(['classic_anniversary', 'classic_era', 'classic']);
    });

    it('offers Forever in the pickers once the capability is on', () => {
        expect(armoryClassicVariants(FOREVER_ON).map((v) => v.value)).toEqual(['classic_anniversary', 'classic_era', 'classic', 'wow_forever']);
    });
});

describe('defaultArmoryClassicVariant (ROK-1717)', () => {
    it('falls back to the first importable variant for a Forever context while the capability is off', () => {
        expect(defaultArmoryClassicVariant('wow_forever', undefined)).toBe('classic_anniversary');
        expect(defaultArmoryClassicVariant('wow_forever', FOREVER_OFF)).toBe('classic_anniversary');
    });

    it('keeps a Forever context variant once the capability is on', () => {
        expect(defaultArmoryClassicVariant('wow_forever', FOREVER_ON)).toBe('wow_forever');
    });

    it('defaults to the first importable variant with no context', () => {
        expect(defaultArmoryClassicVariant(undefined, FOREVER_ON)).toBe('classic_anniversary');
    });
});
