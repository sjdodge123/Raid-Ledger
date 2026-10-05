/**
 * Addon "Import string" API + mutations (ROK-1724 §4.4).
 *
 * `POST /plugins/wow/characters/:id/addon-import` with `dryRun: true` is the
 * preview; `dryRun: false` applies. `fetchApi` flattens an error body to its
 * `message`, but the dialog branches on the contract's error `code` (and the
 * `NAME_MISMATCH` prefill), so this goes through `fetchWithAuth` and keeps the
 * parsed body on `AddonImportRequestError`.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
    AddonImportErrorBodySchema,
    AddonImportResultSchema,
    type AddonImportAddCharacterPrefill,
    type AddonImportErrorCode,
    type AddonImportRequestInput,
    type AddonImportResultDto,
} from '@raid-ledger/contract';
import { fetchWithAuth } from '../../../../lib/api/fetch-api';

export type AddonImportConfirm = NonNullable<AddonImportRequestInput['confirm']>;

/** What the dialog sends: the paste plus any ticked confirmations. */
export interface AddonImportVariables {
    importString: string;
    confirm?: AddonImportConfirm | undefined;
}

/** A failed import. `code` is null when the body was not a contract error. */
export class AddonImportRequestError extends Error {
    readonly code: AddonImportErrorCode | null;
    readonly status: number;
    readonly addCharacter: AddonImportAddCharacterPrefill | undefined;

    constructor(status: number, code: AddonImportErrorCode | null, message: string, addCharacter?: AddonImportAddCharacterPrefill) {
        super(message);
        Object.setPrototypeOf(this, AddonImportRequestError.prototype);
        this.name = 'AddonImportRequestError';
        this.status = status;
        this.code = code;
        this.addCharacter = addCharacter;
    }
}

export function addonImportPath(characterId: string): string {
    return `/plugins/wow/characters/${encodeURIComponent(characterId)}/addon-import`;
}

async function toRequestError(response: Response): Promise<AddonImportRequestError> {
    const raw: unknown = await response.json().catch(() => null);
    const parsed = AddonImportErrorBodySchema.safeParse(raw);
    if (parsed.success) {
        return new AddonImportRequestError(response.status, parsed.data.code, parsed.data.message, parsed.data.addCharacter);
    }
    return new AddonImportRequestError(response.status, null, `HTTP ${response.status}`);
}

/** One import call. Throws `AddonImportRequestError` on any non-2xx or an off-contract body. */
export async function postAddonImport(characterId: string, body: AddonImportRequestInput): Promise<AddonImportResultDto> {
    const response = await fetchWithAuth(addonImportPath(characterId), { method: 'POST', body: JSON.stringify(body) });
    if (!response.ok) throw await toRequestError(response);
    const parsed = AddonImportResultSchema.safeParse(await response.json().catch(() => null));
    if (!parsed.success) throw new AddonImportRequestError(response.status, null, 'Unexpected response from the server.');
    return parsed.data;
}

function requestBody(vars: AddonImportVariables, dryRun: boolean): AddonImportRequestInput {
    return { importString: vars.importString, dryRun, ...(vars.confirm ? { confirm: vars.confirm } : {}) };
}

/** Preview (`dryRun: true`) — reads only, never invalidates. */
export function useAddonImportPreview(characterId: string) {
    return useMutation<AddonImportResultDto, AddonImportRequestError, AddonImportVariables>({
        mutationFn: (vars) => postAddonImport(characterId, requestBody(vars, true)),
    });
}

/** Apply (`dryRun: false`). Success invalidates the character's detail query. */
export function useAddonImportApply(characterId: string) {
    const queryClient = useQueryClient();
    return useMutation<AddonImportResultDto, AddonImportRequestError, AddonImportVariables>({
        mutationFn: (vars) => postAddonImport(characterId, requestBody(vars, false)),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ['characters', characterId] }),
    });
}
