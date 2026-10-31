/**
 * ROK-1960 L2 — the "Upload" mutation (spec D-6 steps 2–5): PUT the
 * thumbnail when there is one, bind the campaign key to the picked campaign,
 * and only then POST the message, so the save lands straight in the picked
 * campaign and never sits in another (another hub's) campaign first. A failed
 * bind aborts before anything is posted. Then invalidate every bg3 query of
 * the hub. Every failure rejects with a `Bg3UploadError`.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Bg3SaveMessage } from '@raid-ledger/contract';
import { bindBg3CampaignKey } from '../api/bg3-api';
import { invalidateBg3Hub } from '../hooks/bg3-keys';
import { buildBg3SaveMessage, postBg3SaveMessage, putBg3Thumbnail, type Bg3ParsedSave } from './bg3-upload-api';
import { Bg3UploadError, toBg3UploadError } from './bg3-upload-errors';

export interface Bg3UploadVars {
    readonly save: Bg3ParsedSave;
    /** The campaign picked in the sheet; the key is always bound to it (a binding beats the default on ingest). */
    readonly campaignId: number;
}

export interface Bg3UploadResult {
    /** `already_uploaded` = the server answered `stale` (same uploader + key + savedAt). */
    readonly status: 'uploaded' | 'already_uploaded';
    readonly campaignId: number;
}

async function putThumbnailIfAny(message: Bg3SaveMessage, webp: Bg3ParsedSave['webp']): Promise<void> {
    const ref = message.payload.thumbnail;
    if (ref === null) return;
    if (webp === null || webp.byteLength !== ref.byteLength) throw new Bg3UploadError('invalid_payload', 'payload.thumbnail');
    await putBg3Thumbnail(ref.sha256, webp);
}

/** D-6 steps 2–4 (blob → bind → message); exported for direct testing. `now` pins `capturedAt`. */
export async function uploadBg3Save(vars: Bg3UploadVars, now: number = Date.now()): Promise<Bg3UploadResult> {
    const message = buildBg3SaveMessage(vars.save, now);
    try {
        await putThumbnailIfAny(message, vars.save.webp);
    } catch (error) {
        throw toBg3UploadError(error);
    }
    await bindBg3CampaignKey(message.payload.campaignKey, vars.campaignId).catch(() => {
        throw new Bg3UploadError('bind_failed');
    });
    try {
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
