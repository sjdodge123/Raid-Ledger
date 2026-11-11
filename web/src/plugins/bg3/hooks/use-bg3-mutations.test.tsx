import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { ReactNode } from 'react';
import { http } from 'msw';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import type { Bg3SnapshotResponse } from '@raid-ledger/contract';
import { createTestQueryClient } from '../../../test/render-helpers';
import { server } from '../../../test/mocks/server';
import {
    BG3_DEFAULT_URL,
    bg3BindKeyCrossHubHandler,
    bg3BindKeyHandler,
    bg3ClaimHandler,
    bg3CreateCampaignHandler,
    bg3DefaultCampaignHandler,
    bg3Error,
    bg3HubSettingsHandler,
    bg3RemoveSavesHandler,
    bg3SnapshotHandler,
    bg3UnclaimHandler,
} from '../../../test/mocks/bg3-handlers';
import { BG3_CAMPAIGN_ID, BG3_HUB_ID, buildBg3CampaignSummary, buildBg3Claim, buildBg3Snapshot } from '../../../test/factories/bg3';
import { toast } from '../../../lib/toast';
import { bg3Keys } from './bg3-keys';
import {
    BG3_CLAIM_CONFLICT_TOAST,
    Bg3BindCrossHubHold,
    BG3_CREATED_DEFAULT_FAILED_TOAST,
    useBindBg3Saves,
    useClaimBg3Slot,
    useCreateBg3Campaign,
    useRemoveBg3Saves,
    useUnclaimBg3Slot,
    useUpdateBg3HubSettings,
} from './use-bg3-mutations';
import { hubClaimKey } from '../../../components/hub/claim/use-hub-claim';
import { hubMediaKeys } from '../../../lib/hub-media-query';

vi.mock('../../../lib/toast', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const SLOT = 'Generic:Human:1';
const VIEWER = buildBg3Claim({ userId: 33, displayName: 'Thistle' });

function setup() {
    const qc = createTestQueryClient();
    qc.setQueryData(bg3Keys.snapshot(BG3_HUB_ID), buildBg3Snapshot());
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
    return { qc, wrapper };
}

function claimOn(qc: ReturnType<typeof setup>['qc']): string | null | undefined {
    const snap = qc.getQueryData<Bg3SnapshotResponse | null>(bg3Keys.snapshot(BG3_HUB_ID));
    if (!snap || snap.empty) return undefined;
    return snap.party.find((s) => s.slotKey === SLOT)?.claim?.displayName ?? null;
}

describe('use-bg3-mutations', () => {
    beforeEach(() => vi.mocked(toast.error).mockClear());

    it('shows the viewer on the slot before the server answers', async () => {
        const { qc, wrapper } = setup();
        server.use(bg3ClaimHandler(204));
        const { result } = renderHook(() => useClaimBg3Slot(BG3_HUB_ID, VIEWER), { wrapper });
        act(() => result.current.mutate({ campaignId: BG3_CAMPAIGN_ID, slotKey: SLOT }));
        await waitFor(() => expect(claimOn(qc)).toBe('Thistle'));
    });

    it('rolls back and toasts on a 409', async () => {
        const { qc, wrapper } = setup();
        server.use(bg3ClaimHandler(409), bg3SnapshotHandler(buildBg3Snapshot()));
        const { result } = renderHook(() => useClaimBg3Slot(BG3_HUB_ID, VIEWER), { wrapper });
        act(() => result.current.mutate({ campaignId: BG3_CAMPAIGN_ID, slotKey: SLOT }));
        await waitFor(() => expect(result.current.isError).toBe(true));
        expect(claimOn(qc)).toBeNull();
        expect(toast.error).toHaveBeenCalledWith(BG3_CLAIM_CONFLICT_TOAST);
    });

    it('binds each selected key once, then sets the default', async () => {
        const { wrapper } = setup();
        const calls: string[] = [];
        server.use(
            bg3BindKeyHandler((b, p) => calls.push(`key:${String(p['campaignKey']).slice(0, 1)}:${JSON.stringify(b)}`)),
            bg3DefaultCampaignHandler((b) => calls.push(`default:${JSON.stringify(b)}`)),
        );
        const { result } = renderHook(() => useBindBg3Saves(BG3_HUB_ID), { wrapper });
        await act(() => result.current.mutateAsync({
            campaignKeys: ['a'.repeat(64), 'b'.repeat(64), 'a'.repeat(64)], campaignId: BG3_CAMPAIGN_ID, alsoDefault: true,
        }));
        expect(calls).toEqual([
            `key:a:{"campaignId":${BG3_CAMPAIGN_ID}}`,
            `key:b:{"campaignId":${BG3_CAMPAIGN_ID}}`,
            `default:{"campaignId":${BG3_CAMPAIGN_ID}}`,
        ]);
    });

    it('settles as created (not failed) when the default PUT fails after the POST, so a retry cannot duplicate', async () => {
        const { wrapper } = setup();
        let creates = 0;
        server.use(
            bg3CreateCampaignHandler(buildBg3CampaignSummary({ id: 12, name: 'The Long Rest' }), () => { creates += 1; }),
            http.put(BG3_DEFAULT_URL, () => bg3Error(500, 'boom')),
        );
        const { result } = renderHook(() => useCreateBg3Campaign(BG3_HUB_ID), { wrapper });
        act(() => result.current.mutate({ name: 'The Long Rest', makeDefault: true }));
        await waitFor(() => expect(result.current.isSuccess || result.current.isError).toBe(true));
        expect(result.current.status).toBe('success');
        expect(result.current.data?.id).toBe(12);
        expect(creates).toBe(1);
        expect(toast.error).toHaveBeenCalledWith(BG3_CREATED_DEFAULT_FAILED_TOAST);
    });
});

describe('useBindBg3Saves cross-hub hold (ROK-1960, operator ruling 2026-10-31)', () => {
    it('a 409 cross_hub_move stops at that key with a hold (no default); confirmCrossHub re-binds only the keys it names', async () => {
        const { wrapper } = setup();
        const calls: string[] = [];
        // The contract needs ≥1 location — an empty list would not parse as a hold (the server never sends one).
        const move = {
            code: 'cross_hub_move' as const, saveCount: 2,
            locations: [{ campaignId: 99, campaignName: 'Honour run', hubId: BG3_HUB_ID + 1, hubName: 'Other Crew' }],
        };
        server.use(
            bg3BindKeyCrossHubHandler(move, (b, p) => calls.push(`key:${String(p['campaignKey']).slice(0, 1)}:${JSON.stringify(b)}`)),
            bg3DefaultCampaignHandler((b) => calls.push(`default:${JSON.stringify(b)}`)),
        );
        const { result } = renderHook(() => useBindBg3Saves(BG3_HUB_ID), { wrapper });
        const vars = { campaignKeys: ['a'.repeat(64)], campaignId: BG3_CAMPAIGN_ID, alsoDefault: true };
        const failure = await result.current.mutateAsync(vars).then(() => null, (e: unknown) => e);
        expect(failure).toBeInstanceOf(Bg3BindCrossHubHold);
        expect(failure instanceof Bg3BindCrossHubHold ? [failure.campaignKey, failure.move] : null).toEqual(['a'.repeat(64), move]);
        await act(() => result.current.mutateAsync({ ...vars, confirmCrossHub: ['a'.repeat(64)] }));
        expect(calls).toEqual([
            `key:a:{"campaignId":${BG3_CAMPAIGN_ID}}`,
            `key:a:{"campaignId":${BG3_CAMPAIGN_ID},"confirmCrossHub":true}`,
            `default:{"campaignId":${BG3_CAMPAIGN_ID}}`,
        ]);
    });
});

describe('ROK-2068 useRemoveBg3Saves', () => {
    const PICTURE_KEY = ['hub-media', 'file', '/api/hubs/1/media/a/thumb'];

    it('POSTs the deduped keys, then marks every hub\'s BG3 queries and Gallery and the save lists stale', async () => {
        const bodies: unknown[] = [];
        server.use(bg3RemoveSavesHandler({ removed: { saves: 2, campaignKeys: 1, thumbnailRefs: 0, galleryPictures: 1 } }, (b) => bodies.push(b)));
        const { qc, wrapper } = setup();
        qc.setQueryData(bg3Keys.myAllSaves, { saves: [], nextCursor: null, defaultCampaignId: null });
        qc.setQueryData([...hubMediaKeys.all(BG3_HUB_ID), 'pages'], { pages: [] });
        qc.setQueryData([...hubMediaKeys.all(BG3_HUB_ID + 1), 'pages'], { pages: [] });
        qc.setQueryData(bg3Keys.snapshot(BG3_HUB_ID + 1), buildBg3Snapshot());
        qc.setQueryData(PICTURE_KEY, new Blob(['png']));
        const { result } = renderHook(() => useRemoveBg3Saves(), { wrapper });
        await act(async () => { await result.current.mutateAsync(['a'.repeat(64), 'a'.repeat(64)]); });
        expect(bodies).toEqual([{ campaignKeys: ['a'.repeat(64)] }]);
        await waitFor(() => expect(qc.getQueryState([...hubMediaKeys.all(BG3_HUB_ID), 'pages'])?.isInvalidated).toBe(true));
        expect(qc.getQueryState(bg3Keys.myAllSaves)?.isInvalidated).toBe(true);
        expect(qc.getQueryState(bg3Keys.snapshot(BG3_HUB_ID))?.isInvalidated).toBe(true);
        // The removed saves may be filed in, and pictured on, any hub (review MINOR-4).
        expect(qc.getQueryState(bg3Keys.snapshot(BG3_HUB_ID + 1))?.isInvalidated).toBe(true);
        expect(qc.getQueryState([...hubMediaKeys.all(BG3_HUB_ID + 1), 'pages'])?.isInvalidated).toBe(true);
        // The picture bytes are immutable and cached forever: refetching them would flicker every picture (fix-1 MINOR-1).
        expect(qc.getQueryState(PICTURE_KEY)?.isInvalidated, 'a cached picture file must not be invalidated').toBe(false);
    });

    describe('refreshes the shared claim prompt (ROK-2153 S6)', () => {
        /** Seed the core claim status as `useHubClaim` caches it (viewer last). */
        function seedClaimStatus(qc: ReturnType<typeof setup>['qc']): readonly unknown[] {
            const key = [...hubClaimKey(BG3_HUB_ID), 'viewer-33'];
            qc.setQueryData(key, { candidates: [] });
            expect(qc.getQueryState(key)?.isInvalidated).toBe(false);
            return key;
        }

        it('after a Party-card claim settles', async () => {
            const { qc, wrapper } = setup();
            const key = seedClaimStatus(qc);
            server.use(bg3ClaimHandler(204));
            const { result } = renderHook(() => useClaimBg3Slot(BG3_HUB_ID, VIEWER), { wrapper });
            act(() => result.current.mutate({ campaignId: BG3_CAMPAIGN_ID, slotKey: SLOT }));
            await waitFor(() => expect(result.current.isSuccess).toBe(true));
            await waitFor(() => expect(qc.getQueryState(key)?.isInvalidated).toBe(true));
        });

        it('after an unclaim settles', async () => {
            const { qc, wrapper } = setup();
            const key = seedClaimStatus(qc);
            server.use(bg3UnclaimHandler(204));
            const { result } = renderHook(() => useUnclaimBg3Slot(BG3_HUB_ID), { wrapper });
            act(() => result.current.mutate({ campaignId: BG3_CAMPAIGN_ID, slotKey: SLOT }));
            await waitFor(() => expect(result.current.isSuccess).toBe(true));
            await waitFor(() => expect(qc.getQueryState(key)?.isInvalidated).toBe(true));
        });

        it('after an active-campaign switch settles, and not for another hub', async () => {
            const { qc, wrapper } = setup();
            const key = seedClaimStatus(qc);
            const otherHub = [...hubClaimKey(BG3_HUB_ID + 1), 'viewer-33'];
            qc.setQueryData(otherHub, { candidates: [] });
            server.use(bg3HubSettingsHandler({ hideLocationAndScreenshots: true, activeCampaignId: BG3_CAMPAIGN_ID }));
            const { result } = renderHook(() => useUpdateBg3HubSettings(BG3_HUB_ID), { wrapper });
            act(() => result.current.mutate({ activeCampaignId: BG3_CAMPAIGN_ID }));
            await waitFor(() => expect(result.current.isSuccess).toBe(true));
            await waitFor(() => expect(qc.getQueryState(key)?.isInvalidated).toBe(true));
            expect(qc.getQueryState(otherHub)?.isInvalidated).toBe(false);
        });
    });
});
