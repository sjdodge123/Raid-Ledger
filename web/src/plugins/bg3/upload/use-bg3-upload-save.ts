/**
 * ROK-1960 L2/F4 — the "Upload" mutation (spec D-6 steps 2–5): bind the
 * campaign key to the picked campaign, then PUT the thumbnail when there is
 * one, and only then POST the message, so the save lands straight in the
 * picked campaign. The bind goes FIRST because it is the step that can stop
 * for the cross-hub confirm (409 `cross_hub_move`): nothing — not even the
 * thumbnail — leaves the browser before the user agrees. A failed bind aborts
 * before anything is sent. Then invalidate every bg3 query of the hub. Every
 * failure rejects with a `Bg3UploadError`.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Bg3SaveMessage } from '@raid-ledger/contract';
import { bindBg3CampaignKey } from '../api/bg3-api';
import { invalidateBg3Hub } from '../hooks/bg3-keys';
import { buildBg3SaveMessage, postBg3SaveMessage, putBg3Thumbnail, type Bg3ParsedSave } from './bg3-upload-api';
import { Bg3UploadError, crossHubMoveOf, toBg3UploadError } from './bg3-upload-errors';

export interface Bg3UploadVars {
    readonly save: Bg3ParsedSave;
    /** The campaign picked in the sheet; the key is always bound to it (a binding beats the default on ingest). */
    readonly campaignId: number;
    /** Set by "Move here": the user agreed to move this key's saves out of another hub. */
    readonly confirmCrossHub?: boolean;
}

export interface Bg3UploadResult {
    /** `already_uploaded` = the server answered `stale` (same uploader + key + savedAt). */
    readonly status: 'uploaded' | 'already_uploaded';
    readonly campaignId: number;
}

/** The thumbnail bytes to PUT, checked against the ref before any request. */
function thumbnailOf(message: Bg3SaveMessage, webp: Bg3ParsedSave['webp']): Bg3ParsedSave['webp'] {
    const ref = message.payload.thumbnail;
    if (ref === null) return null;
    if (webp === null || webp.byteLength !== ref.byteLength) throw new Bg3UploadError('invalid_payload', 'payload.thumbnail');
    return webp;
}

async function bindKey(message: Bg3SaveMessage, vars: Bg3UploadVars): Promise<void> {
    try {
        await bindBg3CampaignKey(message.payload.campaignKey, vars.campaignId, vars.confirmCrossHub === true);
    } catch (error) {
        const move = crossHubMoveOf(error);
        throw move === null ? new Bg3UploadError('bind_failed') : new Bg3UploadError('cross_hub_move', null, move);
    }
}

/** D-6 steps 2–4 (bind → blob → message); exported for direct testing. `now` pins `capturedAt`. */
export async function uploadBg3Save(vars: Bg3UploadVars, now: number = Date.now()): Promise<Bg3UploadResult> {
    const message = buildBg3SaveMessage(vars.save, now);
    const webp = thumbnailOf(message, vars.save.webp);
    await bindKey(message, vars);
    try {
        const ref = message.payload.thumbnail;
        if (ref !== null && webp !== null) await putBg3Thumbnail(ref.sha256, webp);
        const ack = await postBg3SaveMessage(message);
        return { status: ack.status === 'stale' ? 'already_uploaded' : 'uploaded', campaignId: vars.campaignId };
    } catch (error) {
        throw toBg3UploadError(error);
    }
}

/** The sheet's Upload button (D-6 step 5: invalidate snapshot, campaigns and my saves on settle). */
export function useBg3UploadSave(hubId: number) {
    const qc = useQueryClient();
    return useMutation<Bg3UploadResult, Bg3UploadError, Bg3UploadVars>({
        mutationFn: (vars) => uploadBg3Save(vars),
        onSettled: () => invalidateBg3Hub(qc, hubId),
    });
}
