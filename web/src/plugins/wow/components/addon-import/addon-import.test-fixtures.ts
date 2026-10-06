/** Test-only fixtures for the addon "Import string" components. */
import type { AddonImportResultDto } from '@raid-ledger/contract';

export const CHARACTER_ID = 'char-42';
export const IMPORT_URL = `http://localhost:3000/plugins/wow/characters/${CHARACTER_ID}/addon-import`;
/** 2026-10-04 12:00:00 UTC — midday, so the en-GB date is the same in every timezone. */
export const EXPORTED_AT = 1_791_115_200;

export const CHAR_STRING = '!RL1!char!eJyrVkrLz1eyUkpKLFKqBQAdJgSn';

export function charResult(overrides: Partial<Extract<AddonImportResultDto, { section: 'char' }>> = {}): AddonImportResultDto {
    return {
        section: 'char',
        status: 'preview',
        exportedAt: EXPORTED_AT,
        warnings: [],
        diff: {},
        summary: { gearCount: 17, avgIlvl: 61.4, talentNodes: 31, lockouts: 2 },
        ...overrides,
    };
}
