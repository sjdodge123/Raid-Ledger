/**
 * ROK-1958 D-4/D-5/D-6/D-11/D-12 — BG3 mutations. Each one invalidates the
 * hub's `['bg3', …]` queries on settle. Claims are optimistic on the snapshot
 * query; a 409 rolls back, toasts and refetches (D-6).
 */
import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { Bg3HubSettingsBody, Bg3PartyClaim, Bg3SnapshotResponse } from '@raid-ledger/contract';
import { errorBodyOf, isConflictError } from '../../../lib/api/api-error';
import { toast } from '../../../lib/toast';
import {
    bindBg3CampaignKey,
    claimBg3Slot,
    createBg3Campaign,
    setBg3DefaultCampaign,
    unclaimBg3Slot,
    updateBg3Campaign,
    updateBg3HubSettings,
    type Bg3UpdateCampaignInput,
} from '../api/bg3-api';
import { bg3Keys, invalidateBg3Hub } from './bg3-keys';

export const BG3_CLAIM_CONFLICT_TOAST = 'Someone claimed this character first.';
export const BG3_CLAIM_ERROR_TOAST = "Couldn't update the claim.";
/** 409 `already_claimed`: the viewer's claim sits on a character no longer in the party. */
export const BG3_CLAIM_ALREADY_TOAST = "You've already claimed a character in this campaign.";

/** The campaign exists but the default PUT failed — the dialog still closes, so a retry can't duplicate it. */
export const BG3_CREATED_DEFAULT_FAILED_TOAST =
    "Campaign started, but your saves weren't moved into it. Pick it under “New saves go to” on the Campaign tab.";

/**
 * Start a campaign; `makeDefault` also files the caller's saves into it (D-4).
 * Once the POST succeeds the mutation succeeds: a failed default PUT is a
 * partial success (toast), never a rejection that invites a duplicate create.
 */
export function useCreateBg3Campaign(hubId: number) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async ({ name, makeDefault }: { name: string; makeDefault: boolean }) => {
            const campaign = await createBg3Campaign(hubId, name);
            if (makeDefault) {
                await setBg3DefaultCampaign(campaign.id).catch(() => toast.error(BG3_CREATED_DEFAULT_FAILED_TOAST));
            }
            return campaign;
        },
        onSettled: () => invalidateBg3Hub(qc, hubId),
    });
}

/** Rename / archive (D-11) a campaign. */
export function useUpdateBg3Campaign(hubId: number) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ campaignId, body }: { campaignId: number; body: Bg3UpdateCampaignInput }) =>
            updateBg3Campaign(campaignId, body),
        onSettled: () => invalidateBg3Hub(qc, hubId),
    });
}

/** "New saves go to:" (`null` = no campaign). */
export function useSetBg3DefaultCampaign(hubId: number) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (campaignId: number | null) => setBg3DefaultCampaign(campaignId),
        onSettled: () => invalidateBg3Hub(qc, hubId),
    });
}

/** Add my saves (D-5): one key PUT per ticked playthrough (each binds every save with that key), then the optional default. */
export function useBindBg3Saves(hubId: number) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (v: { campaignKeys: readonly string[]; campaignId: number; alsoDefault: boolean }) => {
            for (const key of new Set(v.campaignKeys)) await bindBg3CampaignKey(key, v.campaignId);
            if (v.alsoDefault) await setBg3DefaultCampaign(v.campaignId);
        },
        onSettled: () => invalidateBg3Hub(qc, hubId),
    });
}

/** Spoiler switch + active campaign (D-12). */
export function useUpdateBg3HubSettings(hubId: number) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (body: Bg3HubSettingsBody) => updateBg3HubSettings(hubId, body),
        onSettled: () => invalidateBg3Hub(qc, hubId),
    });
}

type Snap = Bg3SnapshotResponse | null | undefined;

/** The snapshot with `slotKey`'s claim replaced (no-op on empty / missing data). */
export function withSlotClaim(snap: Snap, slotKey: string, claim: Bg3PartyClaim | null): Snap {
    if (!snap || snap.empty) return snap;
    return { ...snap, party: snap.party.map((s) => (s.slotKey === slotKey ? { ...s, claim } : s)) };
}

interface ClaimVars { campaignId: number; slotKey: string }

function useOptimisticClaim(hubId: number, claimFor: () => Bg3PartyClaim | null, send: (v: ClaimVars) => Promise<void>) {
    const qc = useQueryClient();
    const key = bg3Keys.snapshot(hubId);
    return useMutation({
        mutationFn: send,
        onMutate: async ({ slotKey }: ClaimVars) => {
            await qc.cancelQueries({ queryKey: key });
            const previous = qc.getQueryData<Snap>(key);
            qc.setQueryData<Snap>(key, (old) => withSlotClaim(old, slotKey, claimFor()));
            return { previous };
        },
        onError: (error, _v, ctx) => rollback(qc, key, ctx?.previous, error),
        onSettled: () => invalidateBg3Hub(qc, hubId),
    });
}

function rollback(qc: QueryClient, key: readonly unknown[], previous: Snap, error: unknown): void {
    qc.setQueryData<Snap>(key, previous);
    toast.error(claimErrorToast(error));
}

/** 409 `already_claimed` / `slot_taken` (D-6) each get their own message. */
function claimErrorToast(error: unknown): string {
    if (!isConflictError(error)) return BG3_CLAIM_ERROR_TOAST;
    return errorBodyOf(error)?.['message'] === 'already_claimed' ? BG3_CLAIM_ALREADY_TOAST : BG3_CLAIM_CONFLICT_TOAST;
}

/** "That's me" — `viewer` is shown on the slot until the server answers. */
export function useClaimBg3Slot(hubId: number, viewer: Bg3PartyClaim) {
    return useOptimisticClaim(hubId, () => viewer, (v) => claimBg3Slot(v.campaignId, v.slotKey));
}

/** "Not me" (own claim) or a host/editor/staff removing someone's claim. */
export function useUnclaimBg3Slot(hubId: number) {
    return useOptimisticClaim(hubId, () => null, (v) => unclaimBg3Slot(v.campaignId, v.slotKey));
}
