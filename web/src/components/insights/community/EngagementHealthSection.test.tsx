/**
 * EngagementHealthSection.test.tsx (ROK-1099 review)
 *
 * Verifies the partial-failure rendering contract: when one of the two
 * composed hooks (engagement, churn) returns 503 NoSnapshotYet and the
 * other returns data, the panel renders the available block AND does
 * NOT show the empty-state hint. This regression-tests the `||` → `&&`
 * fix for the composite status mask.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../../test/render-helpers';
import { server } from '../../../test/mocks/server';
import { EngagementHealthSection } from './EngagementHealthSection';

const API = 'http://localhost:3000';

const engagementPayload = {
    snapshotDate: '2026-04-22',
    weeklyActiveUsers: [
        { weekStart: '2026-04-15', count: 12 },
        { weekStart: '2026-04-08', count: 9 },
    ],
    intensityHistogram: [
        { tier: 'Hardcore', count: 3 },
        { tier: 'Casual', count: 6 },
    ],
};

const churnPayload = {
    snapshotDate: '2026-04-22',
    thresholdPct: 70,
    baselineWeeks: 12,
    recentWeeks: 4,
    notEnoughHistory: false,
    atRisk: [],
    candidates: [],
};

describe('EngagementHealthSection', () => {
    beforeEach(() => {
        server.use(
            http.get(`${API}/insights/community/engagement`, () =>
                HttpResponse.json(engagementPayload),
            ),
            http.get(`${API}/insights/community/churn`, () =>
                HttpResponse.json(churnPayload),
            ),
        );
    });

    it('renders engagement data even when churn returns 503 no_snapshot_yet', async () => {
        server.use(
            http.get(`${API}/insights/community/churn`, () =>
                new HttpResponse(null, { status: 503 }),
            ),
        );
        renderWithProviders(<EngagementHealthSection />);

        await waitFor(() =>
            expect(screen.getByText(/12-week Weekly Active Users/i)).toBeInTheDocument(),
        );
        expect(
            screen.queryByText(/No engagement snapshot has been computed yet/i),
        ).not.toBeInTheDocument();
    });

    it('renders churn data even when engagement returns 503 no_snapshot_yet', async () => {
        server.use(
            http.get(`${API}/insights/community/engagement`, () =>
                new HttpResponse(null, { status: 503 }),
            ),
        );
        renderWithProviders(<EngagementHealthSection />);

        await waitFor(() =>
            expect(
                screen.getByRole('heading', { name: /^Churn Risk$/i }),
            ).toBeInTheDocument(),
        );
        expect(
            screen.queryByText(/No engagement snapshot has been computed yet/i),
        ).not.toBeInTheDocument();
    });

    it('shows the empty-state hint only when BOTH hooks return 503', async () => {
        server.use(
            http.get(`${API}/insights/community/engagement`, () =>
                new HttpResponse(null, { status: 503 }),
            ),
            http.get(`${API}/insights/community/churn`, () =>
                new HttpResponse(null, { status: 503 }),
            ),
        );
        renderWithProviders(<EngagementHealthSection />);

        await waitFor(() =>
            expect(
                screen.getByText(/No engagement snapshot has been computed yet/i),
            ).toBeInTheDocument(),
        );
    });
});
