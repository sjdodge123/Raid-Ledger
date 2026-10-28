import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import type { Bg3SnapshotResponse } from '@raid-ledger/contract';
import { createTestQueryClient } from '../../../test/render-helpers';
import { server } from '../../../test/mocks/server';
import {
    bg3BindKeyHandler,
    bg3ClaimHandler,
    bg3DefaultCampaignHandler,
    bg3SnapshotHandler,
} from '../../../test/mocks/bg3-handlers';
import { BG3_CAMPAIGN_ID, BG3_HUB_ID, buildBg3Claim, buildBg3Snapshot } from '../../../test/factories/bg3';
import { toast } from '../../../lib/toast';
import { bg3Keys } from './bg3-keys';
import { BG3_CLAIM_CONFLICT_TOAST, useBindBg3Saves, useClaimBg3Slot } from './use-bg3-mutations';

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
});
