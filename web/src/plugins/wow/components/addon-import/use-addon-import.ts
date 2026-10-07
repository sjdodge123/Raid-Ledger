/**
 * Addon "Import string" API + mutations (ROK-1724 §4.4).
 *
 * `POST /plugins/wow/characters/:id/addon-import` with `dryRun: true` is the
 * preview; `dryRun: false` applies. `fetchApi` flattens an error body to its
 * `message`, but the dialog branches on the contract's error `code` (and the
 * `NAME_MISMATCH` prefill), so this goes through `fetchWithAuth` and keeps the
 * parsed body on `AddonImportRequestError`.
 *
 * ROK-1738: `POST /plugins/wow/characters/addon-import` (no id) is the create
 * route Add Character uses — same dry-run/apply split, plus the resolved
 * `target` in the result and an optional picked `ruleset` in the request.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
    AddonImportErrorBodySchema,
    AddonImportNewResultSchema,
    AddonImportResultSchema,
    type AddonImportAddCharacterPrefill,
    type AddonImportErrorCode,
    type AddonImportNewRequestInput,
    type AddonImportNewResultDto,
    type AddonImportRequestInput,
    type AddonImportResultDto,
    type WowForeverSelectableRuleset,
} from '@raid-ledger/contract';
import { fetchWithAuth } from '../../../../lib/api/fetch-api';

export type AddonImportConfirm = NonNullable<AddonImportRequestInput['confirm']>;

/** What the dialog sends: the paste plus any ticked confirmations. */
export interface AddonImportVariables {
    importString: string;
    confirm?: AddonImportConfirm | undefined;
}

/** Create-route variables: also the ruleset the user picked when the export has none (ROK-1738 D13). */
export interface AddonImportNewVariables extends AddonImportVariables {
    ruleset?: WowForeverSelectableRuleset | undefined;
}

/** The id-less create route (ROK-1738 D1). */
export const ADDON_IMPORT_NEW_PATH = '/plugins/wow/characters/addon-import';

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

/** POST + error mapping shared by both routes; the caller parses the success body. */
async function postImport(path: string, body: unknown): Promise<{ status: number; data: unknown }> {
    const response = await fetchWithAuth(path, { method: 'POST', body: JSON.stringify(body) });
    if (!response.ok) throw await toRequestError(response);
    return { status: response.status, data: await response.json().catch(() => null) };
}

function offContract(status: number): AddonImportRequestError {
    return new AddonImportRequestError(status, null, 'Unexpected response from the server.');
}

/** One import call. Throws `AddonImportRequestError` on any non-2xx or an off-contract body. */
export async function postAddonImport(characterId: string, body: AddonImportRequestInput): Promise<AddonImportResultDto> {
    const { status, data } = await postImport(addonImportPath(characterId), body);
    const parsed = AddonImportResultSchema.safeParse(data);
    if (!parsed.success) throw offContract(status);
    return parsed.data;
}

/** One create-route call (ROK-1738). Same error contract as `postAddonImport`. */
export async function postAddonImportNew(body: AddonImportNewRequestInput): Promise<AddonImportNewResultDto> {
    const { status, data } = await postImport(ADDON_IMPORT_NEW_PATH, body);
    const parsed = AddonImportNewResultSchema.safeParse(data);
    if (!parsed.success) throw offContract(status);
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

function newRequestBody(vars: AddonImportNewVariables, dryRun: boolean): AddonImportNewRequestInput {
    return { ...requestBody(vars, dryRun), ...(vars.ruleset ? { ruleset: vars.ruleset } : {}) };
}

/** Create-route preview (`dryRun: true`) — resolves the target, writes nothing, never invalidates. */
export function useAddonImportNewPreview() {
    return useMutation<AddonImportNewResultDto, AddonImportRequestError, AddonImportNewVariables>({
        mutationFn: (vars) => postAddonImportNew(newRequestBody(vars, true)),
    });
}

/** Create-route apply. A character was created or updated: refresh every character list and detail. */
export function useAddonImportNewApply() {
    const queryClient = useQueryClient();
    return useMutation<AddonImportNewResultDto, AddonImportRequestError, AddonImportNewVariables>({
        mutationFn: (vars) => postAddonImportNew(newRequestBody(vars, false)),
        onSuccess: () => Promise.all([
            queryClient.invalidateQueries({ queryKey: ['me', 'characters'] }),
            queryClient.invalidateQueries({ queryKey: ['characters'] }),
        ]),
    });
}
