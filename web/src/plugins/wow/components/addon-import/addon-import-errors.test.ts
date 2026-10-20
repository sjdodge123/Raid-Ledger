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

    it('shows the server message for INVALID_PAYLOAD (e.g. the export-clock bound, ROK-1756)', () => {
        const clock = "The import string's date doesn't match the server clock — check your computer's date and export again.";
        const copy = addonImportErrorCopy(new AddonImportRequestError(422, 'INVALID_PAYLOAD', clock));
        expect(copy.title).toBe("Can't import this string");
        expect(copy.body).toBe(clock);
    });

    it('keeps the generic INVALID_PAYLOAD body when the server sends no message', () => {
        const copy = addonImportErrorCopy(new AddonImportRequestError(422, 'INVALID_PAYLOAD', ''));
        expect(copy.body).toBe('The string decoded, but its contents are not in the expected format.');
    });

    it('NOT_IN_GUILD from the re-import guard says only an admin or an admin-made guild editor may update the roster (ROK-1794)', () => {
        const server = 'Only an admin, or a member an admin has made a guild editor, can update this roster.';
        const copy = addonImportErrorCopy(new AddonImportRequestError(422, 'NOT_IN_GUILD', server));
        expect(copy.title).toBe('Ask an admin for editor rights');
        expect(copy.body).toBe('Only an admin, or a member an admin has made a guild editor, can update this roster. Ask an admin to make you a guild editor, then import again.');
    });

    it('NOT_IN_GUILD for an exporter missing from the roster keeps the roster copy', () => {
        const copy = addonImportErrorCopy(new AddonImportRequestError(422, 'NOT_IN_GUILD', 'The exporting character is not in that guild roster.'));
        expect(copy.title).toBe('Not in this guild');
        expect(copy.body).toBe('The exporting character is not on that guild roster.');
    });

    it('falls back for a non-contract error and never echoes its message', () => {
        const copy = addonImportErrorCopy(new AddonImportRequestError(500, null, '!RL1!char!secret'));
        expect(copy.title).toBe('Import failed');
        expect(JSON.stringify(copy)).not.toContain('secret');
        expect(addonImportErrorCopy(new Error('boom')).title).toBe('Import failed');
    });
});
