/**
 * Error code → dialog copy for the addon "Import string" flow (ROK-1724 §4.4).
 * Codes: `AddonImportErrorCodeSchema` (contract) and
 * `packages/contract/ledgerlink/v1/CONTRACT.md` §7. Copy never echoes the paste.
 */
import type { AddonImportAddCharacterPrefill, AddonImportErrorCode } from '@raid-ledger/contract';
import { AddonImportRequestError } from './use-addon-import';

/** The profile characters panel (`app-routes.tsx` → `gaming/characters`). */
export const PROFILE_CHARACTERS_PATH = '/profile/gaming/characters';

/**
 * Router state the characters panel reads to open Add Character prefilled
 * (ROK-1724 §4.0 core hook #2): `location.state.addCharacter`.
 */
export interface AddCharacterRouterPrefill {
    gameId: number;
    /** Forever two-part name, "First Second". */
    name: string;
    region?: string;
    ruleset?: string | null;
    class?: string;
}

export interface AddonImportErrorAction {
    label: string;
    to: string;
    state: { addCharacter: AddCharacterRouterPrefill };
}

export interface AddonImportErrorCopy {
    title: string;
    body: string;
    action?: AddonImportErrorAction;
}

const COPY: Record<AddonImportErrorCode, Omit<AddonImportErrorCopy, 'action'>> = {
    TOO_LARGE: { title: 'String too large', body: 'Import strings are capped at 256 KB. Export one section at a time.' },
    BAD_HEADER: { title: 'Not an import string', body: 'That text does not start with !RL1!. Copy the whole string from the addon window.' },
    UNSUPPORTED_VERSION: { title: 'Unsupported addon version', body: 'This string comes from a newer or older addon version. Update the addon and export again.' },
    CUT_OFF: { title: 'String looks cut off', body: 'Part of the string is missing. Copy it again from the addon window with Ctrl+A, Ctrl+C.' },
    DECODED_TOO_LARGE: { title: 'Export too large', body: 'This export expands to more data than one import allows.' },
    INVALID_PAYLOAD: { title: 'Unreadable export', body: 'The string decoded, but its contents are not in the expected format.' },
    PAGES_INCOMPLETE: { title: 'Pages missing', body: 'This export has several pages. Paste every page once, in one box.' },
    WRONG_GAME: { title: 'Not a WoW: Forever character', body: 'Addon strings can only be imported into a WoW: Forever character.' },
    REGION_MISMATCH: { title: 'Different region', body: 'The export is from a character in another region than this one.' },
    NAME_MISMATCH: { title: 'Different character', body: 'The export is from another character. Add it as a new character, then import there.' },
    NOT_IN_GUILD: { title: 'Not in this guild', body: 'The exporting character is not on that guild roster.' },
    GUID_CONFIRM_REQUIRED: { title: 'Confirm the in-game character', body: 'The in-game character changed. Tick the confirmation to link it, then import again.' },
    RATE_LIMITED: { title: 'Too many imports', body: 'You have hit the hourly import limit. Try again later.' },
};

const FALLBACK: AddonImportErrorCopy = {
    title: 'Import failed',
    body: 'Something went wrong while checking the string. Try again in a moment.',
};

function nameMismatchAction(prefill: AddonImportAddCharacterPrefill, gameId: number): AddonImportErrorAction {
    return {
        label: 'Add this character',
        to: PROFILE_CHARACTERS_PATH,
        state: {
            addCharacter: {
                gameId,
                name: `${prefill.firstName} ${prefill.secondName}`,
                region: prefill.region,
                ruleset: prefill.ruleset,
                class: prefill.class,
            },
        },
    };
}

/** Copy for a thrown import error. `gameId` is the open character's game, for the Add Character prefill. */
export function addonImportErrorCopy(error: unknown, gameId?: number): AddonImportErrorCopy {
    if (!(error instanceof AddonImportRequestError) || error.code === null) return FALLBACK;
    const copy = COPY[error.code];
    if (error.code === 'NAME_MISMATCH' && error.addCharacter && gameId !== undefined) {
        return { ...copy, action: nameMismatchAction(error.addCharacter, gameId) };
    }
    return copy;
}
