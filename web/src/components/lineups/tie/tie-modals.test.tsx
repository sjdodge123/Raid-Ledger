/**
 * ROK-1374 scenarios 24-25 — the two modals hanging off the readiness card.
 *
 * 24 (E15): no Steam app id means no deep link, and the field a human types
 * into keeps working regardless — SteamDB is a convenience, not a dependency.
 * 25 (E18): a failed measurement leaves a toast and nothing else: no spinner
 * stuck on screen, and no partial figure written.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type { ConnectionSpeedDto, TieReadinessGameDto } from '@raid-ledger/contract';
import { server } from '../../../test/mocks/server';
import { renderWithProviders } from '../../../test/render-helpers';
import { InstallSizeEntryModal } from './InstallSizeEntryModal';
import { ConnectionSpeedConsentModal } from './ConnectionSpeedConsentModal';
import { runSpeedTest } from '../../../lib/speedtest/ndt7-runner';
import { toast } from '../../../lib/toast';

vi.mock('../../../lib/speedtest/ndt7-runner', () => ({
    canAutoRunSpeedTest: vi.fn(() => ({ ok: true, reason: 'ok' })),
    runSpeedTest: vi.fn(async () => 150),
}));
vi.mock('../../../lib/toast', () => ({
    toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

const API = 'http://localhost:3000';

function makeGame(over: Partial<TieReadinessGameDto> = {}): TieReadinessGameDto {
    return {
        gameId: 11,
        gameName: 'Deep Rock Galactic',
        gameCoverUrl: null,
        voteCount: 4,
        steamAppId: 548430,
        ownedCount: 7,
        rosterSize: 9,
        youOwn: true,
        installSizeBytes: null,
        downloadSizeBytes: null,
        installSizeSource: null,
        installSizeUpdatedAt: null,
        estimatedDownloadMinutes: null,
        rosterEtas: [],
        ...over,
    };
}

const speed: ConnectionSpeedDto = {
    downstreamMbps: null,
    source: null,
    measuredAt: null,
    consentAt: null,
    shareEtaAt: null,
};

/** Consented and measured — the only state in which sharing can be turned on. */
const measured: ConnectionSpeedDto = {
    downstreamMbps: 150,
    source: 'ndt7',
    measuredAt: '2026-09-01T12:00:00.000Z',
    consentAt: '2026-08-01T12:00:00.000Z',
    shareEtaAt: null,
};

const SHARE_LABEL = 'Share my download ETA with lineup rosters';

beforeEach(() => {
    vi.mocked(toast.error).mockClear();
    vi.mocked(runSpeedTest).mockReset();
});

describe('scenario 24 — the size modal without a Steam app id (E15)', () => {
    it('renders no SteamDB link and keeps the numeric field enabled', () => {
        renderWithProviders(
            <InstallSizeEntryModal
                lineupId={7}
                game={makeGame({ steamAppId: null })}
                isOpen
                onClose={() => undefined}
            />,
        );
        expect(screen.queryByRole('link', { name: /steamdb/i })).not.toBeInTheDocument();
        expect(screen.getByLabelText(/Install size \(GB\)/)).toBeEnabled();
    });

    it('says the install size is what the estimate is worked out from', () => {
        renderWithProviders(
            <InstallSizeEntryModal
                lineupId={7}
                game={makeGame()}
                isOpen
                onClose={() => undefined}
            />,
        );
        expect(
            screen.getByText(/download estimate is worked out from/i),
        ).toBeInTheDocument();
    });

    it('deep-links to the depots page when the app id is present', () => {
        renderWithProviders(
            <InstallSizeEntryModal
                lineupId={7}
                game={makeGame({ steamAppId: 548430 })}
                isOpen
                onClose={() => undefined}
            />,
        );
        const link = screen.getByRole('link', { name: /steamdb/i });
        expect(link).toHaveAttribute('href', 'https://steamdb.info/app/548430/depots/');
        expect(link).toHaveAttribute('target', '_blank');
    });
});

describe('scenario 25 — a failed measurement writes nothing (E18)', () => {
    it('shows the live gauge while the test runs and feeds it each sample', async () => {
        server.use(
            http.put(`${API}/users/me/speed-test-consent`, () =>
                HttpResponse.json({ ...speed, consentAt: '2026-09-05T17:00:00.000Z' }),
            ),
        );
        let deliver: ((mbps: number) => void) | undefined;
        vi.mocked(runSpeedTest).mockImplementation(
            (_load, onSample) =>
                new Promise<number>(() => {
                    deliver = onSample;
                }),
        );
        renderWithProviders(
            <ConnectionSpeedConsentModal isOpen onClose={() => undefined} speed={speed} />,
        );
        expect(screen.queryByTestId('speed-gauge')).not.toBeInTheDocument();
        await userEvent.click(screen.getByRole('button', { name: 'Run test' }));
        expect(await screen.findByTestId('speed-gauge')).toBeInTheDocument();
        expect(screen.getByTestId('speed-gauge-value')).toHaveTextContent('—');
        act(() => deliver?.(87.6));
        expect(screen.getByTestId('speed-gauge-value')).toHaveTextContent('87.6');
        expect(screen.getByRole('button', { name: 'Running…' })).toBeDisabled();
    });

    it('toasts, clears the spinner, and never persists a figure', async () => {
        const speedWrite = vi.fn();
        server.use(
            http.put(`${API}/users/me/speed-test-consent`, () =>
                HttpResponse.json({ ...speed, consentAt: new Date().toISOString() }),
            ),
            http.put(`${API}/users/me/connection-speed`, () => {
                speedWrite();
                return HttpResponse.json(speed);
            }),
        );
        vi.mocked(runSpeedTest).mockRejectedValue(new Error('ndt7 unreachable'));

        renderWithProviders(
            <ConnectionSpeedConsentModal isOpen onClose={() => undefined} speed={speed} />,
        );
        await userEvent.click(screen.getByRole('button', { name: 'Run test' }));

        await waitFor(() => expect(toast.error).toHaveBeenCalled());
        expect(screen.queryByText('Running…')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Run test' })).toBeEnabled();
        expect(speedWrite).not.toHaveBeenCalled();
    });

    it('states the data cost and M-Lab publication in plain words (D10)', () => {
        renderWithProviders(
            <ConnectionSpeedConsentModal isOpen onClose={() => undefined} speed={speed} />,
        );
        // The 5 s cap bounds only how long the app WAITS — ndt7 offers no abort
        // path, so the transfer runs its full ~10 s course. The copy quotes what
        // actually moves, not the slice the app sticks around for.
        expect(screen.getByText(/about 10 seconds/)).toBeInTheDocument();
        expect(screen.getByText(/cannot be stopped early/)).toBeInTheDocument();
        expect(
            screen.getByText(/usually transfers less than 100 MB of data/),
        ).toBeInTheDocument();
        expect(screen.getByText(/publicly publishes all test results/)).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'privacy policy' })).toHaveAttribute('href', 'https://www.measurementlab.net/privacy/');
    });
});

describe('sharing the ETA is its own switch, default OFF (operator ruling 2026-09-05)', () => {
    it('is unchecked when the user has never shared, and says what sharing exposes', () => {
        renderWithProviders(
            <ConnectionSpeedConsentModal isOpen onClose={() => undefined} speed={measured} />,
        );
        expect(screen.getByRole('checkbox', { name: SHARE_LABEL })).not.toBeChecked();
        expect(
            screen.getByText(/never your speed or how it was measured/),
        ).toBeInTheDocument();
    });

    it('is checked when a share timestamp is on record', () => {
        renderWithProviders(
            <ConnectionSpeedConsentModal
                isOpen
                onClose={() => undefined}
                speed={{ ...measured, shareEtaAt: '2026-09-05T09:00:00.000Z' }}
            />,
        );
        expect(screen.getByRole('checkbox', { name: SHARE_LABEL })).toBeChecked();
    });

    it('turning it on PUTs the sharing switch — and nothing else', async () => {
        const bodies: unknown[] = [];
        const otherWrite = vi.fn();
        server.use(
            http.put(`${API}/users/me/download-eta-sharing`, async ({ request }) => {
                bodies.push(await request.json());
                return HttpResponse.json({ ...measured, shareEtaAt: '2026-09-05T09:00:00.000Z' });
            }),
            http.put(`${API}/users/me/connection-speed`, () => {
                otherWrite();
                return HttpResponse.json(measured);
            }),
            http.put(`${API}/users/me/speed-test-consent`, () => {
                otherWrite();
                return HttpResponse.json(measured);
            }),
        );
        renderWithProviders(
            <ConnectionSpeedConsentModal isOpen onClose={() => undefined} speed={measured} />,
        );
        await userEvent.click(screen.getByRole('checkbox', { name: SHARE_LABEL }));
        await waitFor(() => expect(bodies).toEqual([{ share: true }]));
        expect(otherWrite).not.toHaveBeenCalled();
    });

    it('cannot be turned on before there is a figure to share, and says why', () => {
        renderWithProviders(
            <ConnectionSpeedConsentModal isOpen onClose={() => undefined} speed={speed} />,
        );
        expect(screen.getByRole('checkbox', { name: SHARE_LABEL })).toBeDisabled();
        expect(screen.getByText('Measure or enter a speed first')).toBeInTheDocument();
    });
});
