/** ROK-1958 V-7 (Party half) — who the Party card's `useVisible` probe lets in. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import type { GuildPage } from '@raid-ledger/contract';
import { server } from '../../../test/mocks/server';
import { createTestQueryClient } from '../../../test/render-helpers';
import { BG3_CAMPAIGNS_URL, bg3CampaignsHandler, bg3SnapshotHandler } from '../../../test/mocks/bg3-handlers';
import { BG3_CAMPAIGN_ID, BG3_HUB_ID, buildBg3CampaignsResponse } from '../../../test/factories/bg3';
import type { HubWidgetCtx } from '../../hub-game-widgets';
import { bg3Keys } from './bg3-keys';
import { useBg3Campaigns } from './use-bg3-hub';
import { useBg3PartyVisible } from './use-bg3-visible';

const auth = vi.hoisted(() => ({ user: { id: 33, role: 'member' as string } }));
vi.mock('../../../hooks/use-auth', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../hooks/use-auth')>()),
    useAuth: () => ({ user: auth.user }),
}));

function ctx(role: 'member' | 'visitor'): HubWidgetCtx {
    const page = { guild: { id: BG3_HUB_ID }, viewer: { role, canEdit: false, canManageEditors: false } } as GuildPage;
    // The probe reads only `page.guild.id` and `page.viewer.role`.
    return { page, gameSlug: 'baldurs-gate-3' } as HubWidgetCtx;
}

function probe(role: 'member' | 'visitor') {
    const client = createTestQueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    // `campaigns` shares the probe's query key, so it reports when the response landed.
    const hook = renderHook(() => ({ visible: useBg3PartyVisible(ctx(role)), campaigns: useBg3Campaigns(BG3_HUB_ID, false) }), { wrapper });
    return { ...hook, client };
}

beforeEach(() => {
    auth.user = { id: 33, role: 'member' };
});

describe('useBg3PartyVisible (V-7, Party half)', () => {
    it('hides for a signed-in visitor who is not staff, without asking the api', async () => {
        const calls = vi.fn();
        server.use(http.get(BG3_CAMPAIGNS_URL, () => { calls(); return HttpResponse.json(buildBg3CampaignsResponse()); }));
        const { result, client } = probe('visitor');
        expect(result.current.visible).toBe(false);
        // The probe's campaigns query is disabled for this viewer: idle, never fetched.
        expect(client.getQueryState(bg3Keys.campaigns(BG3_HUB_ID))).toMatchObject({ fetchStatus: 'idle', dataUpdatedAt: 0 });
        expect(calls).not.toHaveBeenCalled();
    });

    it('shows for staff who are not hub members (the api lets staff read)', async () => {
        auth.user = { id: 50, role: 'operator' };
        server.use(bg3CampaignsHandler(buildBg3CampaignsResponse()));
        const { result } = probe('visitor');
        await waitFor(() => expect(result.current.campaigns.isSuccess).toBe(true));
        expect(result.current.visible).toBe(true);
    });

    it('hides when the campaigns route denies the viewer (403)', async () => {
        server.use(bg3CampaignsHandler('forbidden'));
        const { result } = probe('member');
        await waitFor(() => expect(result.current.campaigns.isError).toBe(true));
        expect(result.current.visible).toBe(false);
    });

    it('stays visible for a member when the active campaign has no saves (it carries the binding entry point)', async () => {
        server.use(bg3CampaignsHandler(buildBg3CampaignsResponse()), bg3SnapshotHandler({ empty: true, campaignId: BG3_CAMPAIGN_ID }));
        const { result } = probe('member');
        await waitFor(() => expect(result.current.campaigns.isSuccess).toBe(true));
        expect(result.current.visible).toBe(true);
    });
});
