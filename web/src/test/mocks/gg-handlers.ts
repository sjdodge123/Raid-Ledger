/**
 * MSW handlers for `/gg/*` (ROK-2187). Not in the global set — specs opt in
 * with `server.use(...ggHandlers())` and override per test.
 */
import { http, HttpResponse, type HttpHandler } from 'msw';
import type { GgPublicSummaryDto } from '@raid-ledger/contract';
import { ggPublicFixture, ggSnapshotFixture } from './fixtures/gg-fixtures';
import type { GgOwnerSnapshot } from '../../lib/api/gg-api';

const API_BASE = 'http://localhost:3000';

/** Handlers serving `snapshot` for every year and `pub` for every slug. */
export function ggHandlers(snapshot: GgOwnerSnapshot = ggSnapshotFixture(), pub: GgPublicSummaryDto = ggPublicFixture): HttpHandler[] {
    return [
        http.get(`${API_BASE}/gg/archive`, () => HttpResponse.json({
            years: snapshot.archiveYears.map((year) => ({ year, tier: 'full', computedAt: snapshot.computedAt, shared: false })),
        })),
        http.get(`${API_BASE}/gg/public/:slug`, () => HttpResponse.json(pub)),
        http.get(`${API_BASE}/gg/:year`, ({ params }) => HttpResponse.json({ ...snapshot, year: Number(params['year']) })),
        http.put(`${API_BASE}/gg/:year/share`, async ({ request }) => {
            const { shared } = (await request.json()) as { shared: boolean };
            return HttpResponse.json(shared
                ? { shared: true, slug: 'abcdefghijklmnop1234', sharedAt: '2026-12-15T10:00:00.000Z' }
                : { shared: false, slug: null, sharedAt: null });
        }),
    ];
}
