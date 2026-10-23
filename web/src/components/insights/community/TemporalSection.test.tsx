/**
 * TemporalSection.test.tsx (ROK-1936)
 *
 * The section names the timezone its buckets were computed in; a
 * pre-ROK-1936 snapshot with no `timezone` field was bucketed in UTC, so it
 * reads "Times in UTC".
 */
import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../../test/render-helpers';
import { server } from '../../../test/mocks/server';
import { TemporalSection } from './TemporalSection';

const API = 'http://localhost:3000';

const basePayload = {
    snapshotDate: '2026-10-20',
    heatmap: [{ weekday: 6, hour: 21, activity: 17 }],
    peakHours: [{ weekday: 6, hour: 21, activity: 17 }],
};

function serveTemporal(payload: Record<string, unknown>): void {
    server.use(
        http.get(`${API}/insights/community/temporal`, () => HttpResponse.json(payload)),
    );
}

describe('TemporalSection', () => {
    it('names the timezone the buckets were computed in', async () => {
        serveTemporal({ ...basePayload, timezone: 'America/New_York' });
        renderWithProviders(<TemporalSection />);
        expect(await screen.findByText('Times in America/New_York.')).toBeInTheDocument();
    });

    it('reads "Times in UTC" when an old snapshot has no timezone', async () => {
        serveTemporal(basePayload);
        renderWithProviders(<TemporalSection />);
        expect(await screen.findByTestId('temporal-heatmap')).toBeInTheDocument();
        expect(screen.getByText('Times in UTC.')).toBeInTheDocument();
    });

    it('marks peaks on the heatmap and no longer renders the peak-hours chart', async () => {
        serveTemporal({ ...basePayload, timezone: 'UTC' });
        renderWithProviders(<TemporalSection />);
        expect(await screen.findByTitle('Sat 9pm · 17 sessions')).toBeInTheDocument();
        expect(screen.queryByTestId('peak-hours-chart')).not.toBeInTheDocument();
        expect(screen.queryByText(/Peak Hours by Weekday/i)).not.toBeInTheDocument();
    });
});
