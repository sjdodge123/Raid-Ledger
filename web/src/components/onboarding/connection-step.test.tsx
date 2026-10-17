/**
 * ROK-1374 — the wizard's Connection step (operator ruling 2026-09-05).
 *
 * The bar: it asks in the SAME words the tie card's modal uses, a measurement
 * someone starts feeds the live gauge, a typed figure is written instead, and a
 * returning user is shown what they already have rather than the pitch again.
 * Nothing here ever measures on its own.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { http, HttpResponse } from 'msw';
import type { ConnectionSpeedDto } from '@raid-ledger/contract';
import { server } from '../../test/mocks/server';
import { renderWithProviders } from '../../test/render-helpers';
import { ConnectionStep } from './connection-step';
import { runSpeedTest } from '../../lib/speedtest/ndt7-runner';

vi.mock('../../lib/speedtest/ndt7-runner', () => ({
    runSpeedTest: vi.fn(async () => 150),
}));
vi.mock('../../lib/toast', () => ({
    toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

const API = 'http://localhost:3000';

const unmeasured: ConnectionSpeedDto = {
    downstreamMbps: null,
    source: null,
    measuredAt: null,
    consentAt: null,
    shareEtaAt: null,
};

const measured: ConnectionSpeedDto = {
    downstreamMbps: 150,
    source: 'ndt7',
    measuredAt: '2026-09-01T12:00:00.000Z',
    consentAt: '2026-08-01T12:00:00.000Z',
    shareEtaAt: null,
};

function mount(speed: ConnectionSpeedDto) {
    server.use(
        http.get(`${API}/users/me/connection-speed`, () => HttpResponse.json(speed)),
        http.put(`${API}/users/me/speed-test-consent`, () =>
            HttpResponse.json({ ...speed, consentAt: '2026-09-05T17:00:00.000Z' }),
        ),
    );
    return renderWithProviders(<ConnectionStep />);
}

beforeEach(() => {
    vi.mocked(runSpeedTest).mockReset();
    vi.mocked(runSpeedTest).mockResolvedValue(150);
});

describe('the Connection step asks, and never measures on its own', () => {
    it('says why it wants the figure, in the same words the tie card uses', async () => {
        mount(unmeasured);
        expect(
            screen.getByRole('heading', { name: 'How fast is your connection?' }),
        ).toBeInTheDocument();
        expect(
            screen.getByText(/how long each game would take you to download/),
        ).toBeInTheDocument();
        expect(
            screen.getByText(/usually transfers less than 100 MB of data/),
        ).toBeInTheDocument();
        expect(screen.getByText(/publicly publishes all test results/)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Run test' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Enter manually' })).toBeInTheDocument();
        await waitFor(() => expect(runSpeedTest).not.toHaveBeenCalled());
    });

    it('feeds every sample to the live gauge once someone presses Run test', async () => {
        let deliver: ((mbps: number) => void) | undefined;
        vi.mocked(runSpeedTest).mockImplementation(
            (_load, onSample) =>
                new Promise<number>(() => {
                    deliver = onSample;
                }),
        );
        mount(unmeasured);
        expect(screen.queryByTestId('speed-gauge')).not.toBeInTheDocument();
        await userEvent.click(screen.getByRole('button', { name: 'Run test' }));
        expect(await screen.findByTestId('speed-gauge')).toBeInTheDocument();
        expect(screen.getByTestId('speed-gauge-value')).toHaveTextContent('—');
        act(() => deliver?.(87.6));
        expect(screen.getByTestId('speed-gauge-value')).toHaveTextContent('87.6');
    });

    it('writes a hand-typed figure instead of measuring one', async () => {
        const bodies: unknown[] = [];
        server.use(
            http.put(`${API}/users/me/connection-speed`, async ({ request }) => {
                bodies.push(await request.json());
                return HttpResponse.json({ ...measured, source: 'manual' });
            }),
        );
        mount(unmeasured);
        await userEvent.click(screen.getByRole('button', { name: 'Enter manually' }));
        await userEvent.type(screen.getByLabelText('Download speed (Mbps)'), '42');
        await userEvent.click(screen.getByRole('button', { name: 'Save' }));
        await waitFor(() =>
            expect(bodies).toEqual([{ downstreamMbps: 42, source: 'manual' }]),
        );
        expect(runSpeedTest).not.toHaveBeenCalled();
    });

    it('shows a figure already on record with the way to update it, not the pitch again', async () => {
        mount(measured);
        expect(await screen.findByText(/150.0 Mbps/)).toBeInTheDocument();
        expect(
            screen.queryByText(/usually transfers less than 100 MB of data/),
        ).not.toBeInTheDocument();
        await userEvent.click(
            screen.getByRole('button', { name: 'Update your connection speed' }),
        );
        expect(
            await screen.findByText(/usually transfers less than 100 MB of data/),
        ).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Run test' })).toBeInTheDocument();
    });

    it('offers the roster-sharing switch, inert until there is something to share', () => {
        mount(unmeasured);
        const share = screen.getByRole('checkbox', {
            name: 'Share my download ETA with lineup rosters',
        });
        expect(share).not.toBeChecked();
        expect(share).toBeDisabled();
        expect(screen.getByText('Measure or enter a speed first')).toBeInTheDocument();
    });

    it('enables that switch once a figure is on record', async () => {
        mount(measured);
        await waitFor(() =>
            expect(
                screen.getByRole('checkbox', {
                    name: 'Share my download ETA with lineup rosters',
                }),
            ).toBeEnabled(),
        );
    });

    it('has no accessibility violations', async () => {
        const { container } = mount(unmeasured);
        expect(await axe(container)).toHaveNoViolations();
    });
});
