/**
 * ROK-1958 — MSW fixtures for the `bg3` plugin routes (ROK-1957). Defaults:
 * a hub with NO campaign (snapshot 404 `no_campaign`) and no unassigned
 * saves, so specs that never look at BG3 are unaffected. Specs `server.use()`
 * the builders below; write handlers take an optional `spy` for the body.
 */
import { http, HttpResponse } from 'msw';
import type {
    Bg3CrossHubMove,
    Bg3CampaignSummary,
    Bg3HubCampaignsResponse,
    Bg3MySavesResponse,
    Bg3SessionsResponse,
    Bg3SnapshotResponse,
} from '@raid-ledger/contract';
import { buildBg3CampaignSummary, buildBg3MySavesResponse, buildBg3NoCampaignsResponse } from '../factories/bg3';

export const BG3_URL = 'http://localhost:3000/plugins/bg3';
export const BG3_CAMPAIGNS_URL = `${BG3_URL}/hubs/:hubId/campaigns`;
export const BG3_SNAPSHOT_URL = `${BG3_URL}/hubs/:hubId/snapshot`;
export const BG3_SESSIONS_URL = `${BG3_URL}/hubs/:hubId/campaigns/:campaignId/sessions`;
export const BG3_SETTINGS_URL = `${BG3_URL}/hubs/:hubId/settings`;
export const BG3_MY_SAVES_URL = `${BG3_URL}/me/saves`;
export const BG3_CAMPAIGN_URL = `${BG3_URL}/campaigns/:campaignId`;
export const BG3_DEFAULT_URL = `${BG3_URL}/me/default-campaign`;
export const BG3_KEY_URL = `${BG3_URL}/me/campaign-keys/:campaignKey`;
export const BG3_CLAIMS_URL = `${BG3_URL}/campaigns/:campaignId/claims`;
export const BG3_CLAIM_URL = `${BG3_CLAIMS_URL}/:slotKey`;

export type Bg3Denial = 'forbidden' | 'not-found';
export type Bg3Spy = (body: unknown, params: Record<string, string | readonly string[] | undefined>) => void;

function denial(kind: Bg3Denial, message?: string) {
    const status = kind === 'forbidden' ? 403 : 404;
    return HttpResponse.json({ statusCode: status, message: message ?? (status === 403 ? 'Forbidden' : 'Hub not found') }, { status });
}

/** 409 with the claim service's code (`slot_taken` / `already_claimed`). */
export function bg3Error(status: number, message = 'slot_taken') {
    return HttpResponse.json({ statusCode: status, message }, { status });
}

export function bg3CampaignsHandler(body: Bg3HubCampaignsResponse | Bg3Denial) {
    return http.get(BG3_CAMPAIGNS_URL, () => (typeof body === 'string' ? denial(body) : HttpResponse.json(body)));
}

/** `'no-campaign'` = the 404 `no_campaign` a hub without an active campaign answers. */
export function bg3SnapshotHandler(body: Bg3SnapshotResponse | Bg3Denial | 'no-campaign') {
    return http.get(BG3_SNAPSHOT_URL, () => {
        if (body === 'no-campaign') return denial('not-found', 'no_campaign');
        return typeof body === 'string' ? denial(body) : HttpResponse.json(body);
    });
}

/** Pages keyed by the request's `cursor` (`''` = first page). */
export function bg3SessionsHandler(pages: Record<string, Bg3SessionsResponse>, spy?: (url: URL) => void) {
    return http.get(BG3_SESSIONS_URL, ({ request }) => {
        const url = new URL(request.url);
        spy?.(url);
        const page = pages[url.searchParams.get('cursor') ?? ''];
        return page ? HttpResponse.json(page) : bg3Error(400, 'Invalid cursor');
    });
}

export function bg3MySavesHandler(body: Bg3MySavesResponse) {
    return http.get(BG3_MY_SAVES_URL, () => HttpResponse.json(body));
}

function writeHandler(
    method: 'post' | 'patch' | 'put' | 'delete',
    url: string,
    reply: () => Response,
    spy?: Bg3Spy,
) {
    return http[method](url, async ({ request, params }) => {
        const text = await request.text();
        spy?.(text === '' ? undefined : JSON.parse(text), params);
        return reply();
    });
}

const noContent = () => new HttpResponse(null, { status: 204 });

export const bg3CreateCampaignHandler = (summary: Bg3CampaignSummary = buildBg3CampaignSummary(), spy?: Bg3Spy) =>
    writeHandler('post', BG3_CAMPAIGNS_URL, () => HttpResponse.json(summary, { status: 201 }), spy);
export const bg3UpdateCampaignHandler = (summary: Bg3CampaignSummary = buildBg3CampaignSummary(), spy?: Bg3Spy) =>
    writeHandler('patch', BG3_CAMPAIGN_URL, () => HttpResponse.json(summary), spy);
export const bg3DefaultCampaignHandler = (spy?: Bg3Spy) => writeHandler('put', BG3_DEFAULT_URL, noContent, spy);
export const bg3BindKeyHandler = (spy?: Bg3Spy) => writeHandler('put', BG3_KEY_URL, noContent, spy);
/** ROK-1960 F4: the server's cross-hub guard — 409 `move` unless the body says `confirmCrossHub: true`. */
export function bg3BindKeyCrossHubHandler(move: Bg3CrossHubMove, spy?: Bg3Spy) {
    return http.put(BG3_KEY_URL, async ({ request, params }) => {
        const body: unknown = await request.json();
        spy?.(body, params);
        const confirmed = typeof body === 'object' && body !== null && 'confirmCrossHub' in body && body.confirmCrossHub === true;
        return confirmed ? noContent() : HttpResponse.json(move, { status: 409 });
    });
}
export const bg3HubSettingsHandler = (
    settings: Bg3HubCampaignsResponse['settings'] = { hideLocationAndScreenshots: true, activeCampaignId: null },
    spy?: Bg3Spy,
) => writeHandler('put', BG3_SETTINGS_URL, () => HttpResponse.json(settings), spy);

/** POST claim → 204, or `status` (409 = someone got there first). */
export const bg3ClaimHandler = (status = 204, spy?: Bg3Spy, message = 'slot_taken') =>
    writeHandler('post', BG3_CLAIMS_URL, () => (status === 204 ? noContent() : bg3Error(status, message)), spy);
export const bg3UnclaimHandler = (status = 204, spy?: Bg3Spy) =>
    writeHandler('delete', BG3_CLAIM_URL, () => (status === 204 ? noContent() : bg3Error(status, 'Claim not found')), spy);

export const bg3Handlers = [
    bg3CampaignsHandler(buildBg3NoCampaignsResponse()),
    bg3SnapshotHandler('no-campaign'),
    bg3MySavesHandler(buildBg3MySavesResponse({ saves: [] })),
];
