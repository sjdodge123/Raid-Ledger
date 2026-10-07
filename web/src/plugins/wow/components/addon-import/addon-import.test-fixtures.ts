/** Test-only fixtures for the addon "Import string" components. */
import type { AddonImportNewResultDto, AddonImportResultDto, AddonImportTargetDto } from '@raid-ledger/contract';

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

/** ROK-1738: the id-less create route Add Character posts to. */
export const NEW_IMPORT_URL = 'http://localhost:3000/plugins/wow/characters/addon-import';
export const CREATED_ID = '7b0f6a9e-3c1d-4e2b-9a51-2f6c8d4e0a11';

/** A create-route result: the char result plus the resolved target (a create preview by default). */
export function newCharResult(target: Partial<AddonImportTargetDto> = {}, overrides: Parameters<typeof charResult>[0] = {}): AddonImportNewResultDto {
    return {
        ...charResult(overrides),
        target: { action: 'create', characterId: null, name: 'Ana', region: 'us', ruleset: 'normal', class: 'Paladin', level: 60, ...target },
    };
}
