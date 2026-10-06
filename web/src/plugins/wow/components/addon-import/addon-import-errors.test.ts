import { describe, it, expect } from 'vitest';
import { AddonImportErrorCodeSchema } from '@raid-ledger/contract';
import { PROFILE_CHARACTERS_PATH, addonImportErrorCopy } from './addon-import-errors';
import { AddonImportRequestError } from './use-addon-import';

const PREFILL = { firstName: 'Ana', secondName: 'Forever', region: 'us', ruleset: 'pvp', class: 'Paladin' } as const;

describe('addonImportErrorCopy', () => {
    it.each(AddonImportErrorCodeSchema.options)('has distinct copy for %s', (code) => {
        const copy = addonImportErrorCopy(new AddonImportRequestError(422, code, 'server text'));
        expect(copy.title).not.toBe('Import failed');
        expect(copy.body.length).toBeGreaterThan(10);
        expect(copy.action).toBeUndefined();
    });

    it('links NAME_MISMATCH to Add Character with the prefill as router state', () => {
        const err = new AddonImportRequestError(422, 'NAME_MISMATCH', 'x', { ...PREFILL });
        expect(addonImportErrorCopy(err, 7).action).toEqual({
            label: 'Add this character',
            to: PROFILE_CHARACTERS_PATH,
            state: { addCharacter: { gameId: 7, name: 'Ana Forever', region: 'us', ruleset: 'pvp', class: 'Paladin' } },
        });
    });

    it('drops the action when the game id is unknown', () => {
        const err = new AddonImportRequestError(422, 'NAME_MISMATCH', 'x', { ...PREFILL });
        expect(addonImportErrorCopy(err).action).toBeUndefined();
    });

    it('falls back for a non-contract error and never echoes its message', () => {
        const copy = addonImportErrorCopy(new AddonImportRequestError(500, null, '!RL1!char!secret'));
        expect(copy.title).toBe('Import failed');
        expect(JSON.stringify(copy)).not.toContain('secret');
        expect(addonImportErrorCopy(new Error('boom')).title).toBe('Import failed');
    });
});
