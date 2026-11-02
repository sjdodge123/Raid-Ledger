/**
 * ROK-1958 W1 — read/write client for the ROK-1957 `bg3` plugin routes. Every
 * response is parsed with its contract schema (`fetchApi` throws
 * `SchemaValidationError` on drift); 204 routes resolve `undefined`.
 */
import {
    Bg3CampaignSummarySchema,
    Bg3HubCampaignsResponseSchema,
    Bg3HubSettingsSchema,
    Bg3MySavesResponseSchema,
    Bg3SessionsResponseSchema,
    Bg3SnapshotResponseSchema,
    type Bg3CampaignSummary,
    type Bg3HubCampaignsResponse,
    type Bg3HubSettings,
    type Bg3HubSettingsBody,
    type Bg3MySavesResponse,
    type Bg3SessionsResponse,
    type Bg3SnapshotResponse,
} from '@raid-ledger/contract';
import { fetchApi } from '../../../lib/api/fetch-api';
import { errorBodyOf, httpStatusOf } from '../../../lib/api/api-error';
import { encodePathSegment } from '../../../lib/api/path-segment';

export const BG3_API = '/plugins/bg3';
/** Widget page size (D-9); the api caps `limit` at 20. */
export const BG3_SESSIONS_WIDGET_LIMIT = 5;
export const BG3_SESSIONS_PAGE_LIMIT = 20;

/**
 * PATCH body. `archived` is the D-11 archive flag (`Bg3UpdateCampaignBodySchema`):
 * `true` archives the campaign, `false` restores it.
 */
export interface Bg3UpdateCampaignInput {
    name?: string;
    hostUserId?: number;
    archived?: boolean;
}

const seg = (v: string | number): string => encodePathSegment(String(v));
const json = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) });

/** 403 (visitor) / 404 (hidden hub, missing campaign): the widgets hide (D-10). */
export function isBg3AccessDenied(error: unknown): boolean {
    const status = httpStatusOf(error);
    return status === 403 || status === 404;
}

/** The snapshot route's 404 when the hub has no active campaign (not an access denial). */
export function isBg3NoCampaign(error: unknown): boolean {
    return httpStatusOf(error) === 404 && errorBodyOf(error)?.['message'] === 'no_campaign';
}

export function fetchBg3Campaigns(hubId: number): Promise<Bg3HubCampaignsResponse> {
    return fetchApi(`${BG3_API}/hubs/${seg(hubId)}/campaigns`, {}, Bg3HubCampaignsResponseSchema);
}

/** Active-campaign snapshot; `null` when the hub has no active campaign (404 `no_campaign`). */
export async function fetchBg3Snapshot(hubId: number): Promise<Bg3SnapshotResponse | null> {
    try {
        return await fetchApi(`${BG3_API}/hubs/${seg(hubId)}/snapshot`, {}, Bg3SnapshotResponseSchema);
    } catch (error) {
        if (isBg3NoCampaign(error)) return null;
        throw error;
    }
}

export function fetchBg3Sessions(
    hubId: number,
    campaignId: number,
    cursor: string | null,
    limit: number = BG3_SESSIONS_WIDGET_LIMIT,
): Promise<Bg3SessionsResponse> {
    const q = new URLSearchParams({ limit: String(limit) });
    if (cursor !== null) q.set('cursor', cursor);
    const path = `${BG3_API}/hubs/${seg(hubId)}/campaigns/${seg(campaignId)}/sessions?${q.toString()}`;
    return fetchApi(path, {}, Bg3SessionsResponseSchema);
}

/** Safety stop for the page walk below: 50 saves a page (api `BG3_MY_SAVES_PAGE`) × 40 = 2000 saves. */
export const BG3_MY_SAVES_MAX_PAGES = 40;

function fetchBg3MyUnassignedPage(cursor: string | null): Promise<Bg3MySavesResponse> {
    const q = new URLSearchParams({ unassigned: 'true' });
    if (cursor !== null) q.set('cursor', cursor);
    return fetchApi(`${BG3_API}/me/saves?${q.toString()}`, {}, Bg3MySavesResponseSchema);
}

/**
 * Every one of the caller's saves that is in no campaign: walks `nextCursor`
 * (the api pages 50 at a time) so the Add my saves list and the count are
 * whole. `nextCursor` is non-null only if the safety stop cut the walk short.
 */
export async function fetchBg3MyUnassignedSaves(): Promise<Bg3MySavesResponse> {
    const first = await fetchBg3MyUnassignedPage(null);
    const saves = [...first.saves];
    let cursor = first.nextCursor;
    for (let page = 1; cursor !== null && page < BG3_MY_SAVES_MAX_PAGES; page += 1) {
        const next = await fetchBg3MyUnassignedPage(cursor);
        saves.push(...next.saves);
        cursor = next.nextCursor;
    }
    return { saves, nextCursor: cursor, defaultCampaignId: first.defaultCampaignId };
}

export function createBg3Campaign(hubId: number, name: string): Promise<Bg3CampaignSummary> {
    return fetchApi(`${BG3_API}/hubs/${seg(hubId)}/campaigns`, json('POST', { name }), Bg3CampaignSummarySchema);
}

export function updateBg3Campaign(campaignId: number, body: Bg3UpdateCampaignInput): Promise<Bg3CampaignSummary> {
    return fetchApi(`${BG3_API}/campaigns/${seg(campaignId)}`, json('PATCH', body), Bg3CampaignSummarySchema);
}

/** `null` clears the default; setting one also files the caller's unassigned saves. */
export function setBg3DefaultCampaign(campaignId: number | null): Promise<void> {
    return fetchApi<void>(`${BG3_API}/me/default-campaign`, json('PUT', { campaignId }));
}

/**
 * ROK-1960 F4: without `confirmCrossHub` a bind that would move the caller's
 * saves out of another hub rejects with 409 `cross_hub_move` and moves nothing.
 */
export function bindBg3CampaignKey(campaignKey: string, campaignId: number, confirmCrossHub = false): Promise<void> {
    const body = confirmCrossHub ? { campaignId, confirmCrossHub: true } : { campaignId };
    return fetchApi<void>(`${BG3_API}/me/campaign-keys/${seg(campaignKey)}`, json('PUT', body));
}

export function updateBg3HubSettings(hubId: number, body: Bg3HubSettingsBody): Promise<Bg3HubSettings> {
    return fetchApi(`${BG3_API}/hubs/${seg(hubId)}/settings`, json('PUT', body), Bg3HubSettingsSchema);
}

/** 409 `slot_taken` / `already_claimed` when someone got there first. */
export function claimBg3Slot(campaignId: number, slotKey: string): Promise<void> {
    return fetchApi<void>(`${BG3_API}/campaigns/${seg(campaignId)}/claims`, json('POST', { slotKey }));
}

export function unclaimBg3Slot(campaignId: number, slotKey: string): Promise<void> {
    return fetchApi<void>(`${BG3_API}/campaigns/${seg(campaignId)}/claims/${seg(slotKey)}`, { method: 'DELETE' });
}
