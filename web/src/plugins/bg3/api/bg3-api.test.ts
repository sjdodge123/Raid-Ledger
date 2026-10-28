import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../../../test/mocks/server';
import {
    BG3_MY_SAVES_URL,
    bg3CampaignsHandler,
    bg3SessionsHandler,
    bg3SnapshotHandler,
    bg3UpdateCampaignHandler,
} from '../../../test/mocks/bg3-handlers';
import {
    BG3_CAMPAIGN_ID,
    BG3_HUB_ID,
    buildBg3CampaignsResponse,
    buildBg3MySave,
    buildBg3MySavesResponse,
    buildBg3SessionsResponse,
    buildBg3Snapshot,
} from '../../../test/factories/bg3';
import {
    fetchBg3Campaigns, fetchBg3MyUnassignedSaves, fetchBg3Sessions, fetchBg3Snapshot, isBg3AccessDenied, updateBg3Campaign,
} from './bg3-api';

describe('bg3-api', () => {
    it('parses the factory snapshot through the contract schema', async () => {
        server.use(bg3SnapshotHandler(buildBg3Snapshot()));
        const snap = await fetchBg3Snapshot(BG3_HUB_ID);
        expect(snap?.empty === false && snap.party.length).toBe(5);
    });

    it('maps the no_campaign 404 to null', async () => {
        server.use(bg3SnapshotHandler('no-campaign'));
        await expect(fetchBg3Snapshot(BG3_HUB_ID)).resolves.toBeNull();
    });

    it('throws an access denial for a hidden-hub 404', async () => {
        server.use(bg3SnapshotHandler('not-found'));
        const error = await fetchBg3Snapshot(BG3_HUB_ID).catch((e: unknown) => e);
        expect(isBg3AccessDenied(error)).toBe(true);
    });

    it('treats a visitor 403 on campaigns as an access denial', async () => {
        server.use(bg3CampaignsHandler('forbidden'));
        const error = await fetchBg3Campaigns(BG3_HUB_ID).catch((e: unknown) => e);
        expect(isBg3AccessDenied(error)).toBe(true);
        server.use(bg3CampaignsHandler(buildBg3CampaignsResponse()));
        expect((await fetchBg3Campaigns(BG3_HUB_ID)).settings.activeCampaignId).toBe(BG3_CAMPAIGN_ID);
    });

    it('sends limit and cursor on the sessions route', async () => {
        const urls: URL[] = [];
        const next = buildBg3SessionsResponse({ nextCursor: null });
        server.use(bg3SessionsHandler({ '': buildBg3SessionsResponse({ nextCursor: 'c2' }), c2: next }, (u) => urls.push(u)));
        const first = await fetchBg3Sessions(BG3_HUB_ID, BG3_CAMPAIGN_ID, null);
        await fetchBg3Sessions(BG3_HUB_ID, BG3_CAMPAIGN_ID, first.nextCursor, 20);
        expect(urls.map((u) => u.search)).toEqual(['?limit=5', '?limit=20&cursor=c2']);
    });

    it('PATCHes the campaign body as given', async () => {
        const bodies: unknown[] = [];
        server.use(bg3UpdateCampaignHandler(undefined, (b) => bodies.push(b)));
        await updateBg3Campaign(BG3_CAMPAIGN_ID, { archived: true });
        expect(bodies).toEqual([{ archived: true }]);
    });

    it('follows nextCursor so unassigned saves past the first page of 50 are listed', async () => {
        const urls: string[] = [];
        const page1 = buildBg3MySavesResponse({
            saves: Array.from({ length: 50 }, (_, i) => buildBg3MySave({ id: 1000 + i })),
            nextCursor: 'p2', defaultCampaignId: 77,
        });
        const page2 = buildBg3MySavesResponse({ saves: [buildBg3MySave({ id: 9, saveName: 'Oldest' })], nextCursor: null });
        server.use(http.get(BG3_MY_SAVES_URL, ({ request }) => {
            const url = new URL(request.url);
            urls.push(url.search);
            return HttpResponse.json(url.searchParams.get('cursor') === 'p2' ? page2 : page1);
        }));
        const all = await fetchBg3MyUnassignedSaves();
        expect(all.saves).toHaveLength(51);
        expect(all.saves.at(-1)?.saveName).toBe('Oldest');
        expect(all).toMatchObject({ nextCursor: null, defaultCampaignId: 77 });
        expect(urls).toEqual(['?unassigned=true', '?unassigned=true&cursor=p2']);
    });
});
