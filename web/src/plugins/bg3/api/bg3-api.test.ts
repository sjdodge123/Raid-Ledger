import { describe, expect, it } from 'vitest';
import { server } from '../../../test/mocks/server';
import {
    bg3CampaignsHandler,
    bg3SessionsHandler,
    bg3SnapshotHandler,
    bg3UpdateCampaignHandler,
} from '../../../test/mocks/bg3-handlers';
import {
    BG3_CAMPAIGN_ID,
    BG3_HUB_ID,
    buildBg3CampaignsResponse,
    buildBg3SessionsResponse,
    buildBg3Snapshot,
} from '../../../test/factories/bg3';
import { fetchBg3Campaigns, fetchBg3Sessions, fetchBg3Snapshot, isBg3AccessDenied, updateBg3Campaign } from './bg3-api';

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
});
