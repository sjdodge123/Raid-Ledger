/**
 * MSW handlers for `/insights/community/*` (ROK-1099 + ROK-1310).
 *
 * Extracted from `handlers.ts` when ROK-1310's 6th endpoint pushed that file
 * over the 300-line ESLint cap; same defaults, same fixtures, no behaviour
 * change. Specs override individual routes with `server.use()`.
 */
import { http, HttpResponse } from 'msw';
import {
    radarFixture,
    engagementFixture,
    churnFixture,
    socialGraphFixture,
    temporalFixture,
    keyInsightsFixture,
    refreshFixture,
} from './fixtures/community-insights-fixtures';

const API_BASE = 'http://localhost:3000';

export const communityInsightsHandlers = [
    http.get(`${API_BASE}/insights/community/radar`, () => HttpResponse.json(radarFixture)),
    http.get(`${API_BASE}/insights/community/engagement`, () =>
        HttpResponse.json(engagementFixture),
    ),
    http.get(`${API_BASE}/insights/community/churn`, ({ request }) => {
        const url = new URL(request.url);
        const thresholdPct = Number(
            url.searchParams.get('thresholdPct') ?? churnFixture.thresholdPct,
        );
        return HttpResponse.json({ ...churnFixture, thresholdPct });
    }),
    http.get(`${API_BASE}/insights/community/social-graph`, () =>
        HttpResponse.json(socialGraphFixture),
    ),
    http.get(`${API_BASE}/insights/community/temporal`, () => HttpResponse.json(temporalFixture)),
    http.get(`${API_BASE}/insights/community/key-insights`, () =>
        HttpResponse.json(keyInsightsFixture),
    ),
    // ROK-1310 — live cohort aggregation; empty is a legitimate 200 payload,
    // never 503 no_snapshot_yet.
    http.get(`${API_BASE}/insights/community/cohort-game-frequency`, ({ request }) => {
        const mode = new URL(request.url).searchParams.get('mode') ?? 'matched';
        return HttpResponse.json({ mode, topN: 5, buckets: [] });
    }),
    http.post(`${API_BASE}/insights/community/refresh`, () =>
        HttpResponse.json(refreshFixture, { status: 202 }),
    ),
];
