/**
 * ROK-1374 scenarios 20-23 — the readiness card.
 *
 * The card is a decision aid, so the bar is: it says something useful with
 * nothing but ownership (AC22), it never lies about the age of a size (AC12),
 * it gates only the pick affordance (D16/E20), and it measures a connection
 * only when every guard passes (D10/E23/AC19).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { http, HttpResponse } from 'msw';
import type { ConnectionSpeedDto, TieReadinessResponseDto } from '@raid-ledger/contract';
import { server } from '../../../test/mocks/server';
import { renderWithProviders } from '../../../test/render-helpers';
import { TieReadinessCard } from './TieReadinessCard';
import { canAutoRunSpeedTest, runSpeedTest } from '../../../lib/speedtest/ndt7-runner';

vi.mock('../../../lib/speedtest/ndt7-runner', () => ({
    canAutoRunSpeedTest: vi.fn(() => ({ ok: true, reason: 'ok' })),
    runSpeedTest: vi.fn(async () => 150),
}));

const API = 'http://localhost:3000';
const LINEUP_ID = 7;
const DAY_MS = 24 * 60 * 60 * 1_000;

function daysAgo(days: number): string {
    return new Date(Date.now() - days * DAY_MS).toISOString();
}

function makeGame(over: Partial<TieReadinessResponseDto['games'][number]> = {}) {
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
        ...over,
    };
}

function makeReadiness(over: Partial<TieReadinessResponseDto> = {}): TieReadinessResponseDto {
    return {
        lineupId: LINEUP_ID,
        status: 'awaiting_pick',
        voteCount: 4,
        games: [makeGame(), makeGame({ gameId: 12, gameName: 'Valheim', ownedCount: 5 })],
        rosterSize: 9,
        expiresAt: new Date(Date.now() + 3 * DAY_MS).toISOString(),
        pick: null,
        canPick: true,
        pickerName: 'Roknua',
        viewerSpeedMbps: null,
        viewerSpeedMeasuredAt: null,
        ...over,
    };
}

function makeSpeed(over: Partial<ConnectionSpeedDto> = {}): ConnectionSpeedDto {
    return {
        downstreamMbps: 150,
        source: 'ndt7',
        measuredAt: daysAgo(5),
        consentAt: daysAgo(200),
        ...over,
    };
}

function mount(readiness: TieReadinessResponseDto, speed: ConnectionSpeedDto) {
    server.use(
        http.get(`${API}/lineups/${LINEUP_ID}/tie-readiness`, () => HttpResponse.json(readiness)),
        http.get(`${API}/users/me/connection-speed`, () => HttpResponse.json(speed)),
    );
    return renderWithProviders(<TieReadinessCard lineupId={LINEUP_ID} />);
}

beforeEach(() => {
    vi.mocked(runSpeedTest).mockClear();
    vi.mocked(canAutoRunSpeedTest).mockReturnValue({ ok: true, reason: 'ok' });
});

describe('scenario 20 — the automatic measurement policy (D10 / E23 / AC19)', () => {
    it('does not measure when the stored figure is only 5 days old', async () => {
        mount(makeReadiness(), makeSpeed({ measuredAt: daysAgo(5) }));
        expect(await screen.findByText(/Tied — 4 votes each/)).toBeInTheDocument();
        expect(runSpeedTest).not.toHaveBeenCalled();
    });

    it('measures exactly once when the figure is 100 days old and the guards pass', async () => {
        mount(makeReadiness(), makeSpeed({ measuredAt: daysAgo(100) }));
        await waitFor(() => expect(runSpeedTest).toHaveBeenCalledTimes(1));
        expect(runSpeedTest).toHaveBeenCalledTimes(1);
    });

    it('does not measure when the connection guard refuses', async () => {
        vi.mocked(canAutoRunSpeedTest).mockReturnValue({
            ok: false,
            reason: 'unknown-connection',
        });
        mount(makeReadiness(), makeSpeed({ measuredAt: daysAgo(100) }));
        expect(await screen.findByText(/Tied — 4 votes each/)).toBeInTheDocument();
        expect(runSpeedTest).not.toHaveBeenCalled();
    });

    it('does not measure without consent on record', async () => {
        mount(makeReadiness(), makeSpeed({ measuredAt: null, downstreamMbps: null, consentAt: null }));
        expect(await screen.findByText(/Tied — 4 votes each/)).toBeInTheDocument();
        expect(runSpeedTest).not.toHaveBeenCalled();
    });
});

describe('scenario 21 — a size always carries its provenance and age (AC12)', () => {
    it('renders "46 GB" with an age phrase for a figure entered 90 days ago', async () => {
        mount(
            makeReadiness({
                games: [
                    makeGame({
                        installSizeBytes: 46_000_000_000,
                        installSizeSource: 'manual',
                        installSizeUpdatedAt: daysAgo(90),
                    }),
                ],
            }),
            makeSpeed(),
        );
        const line = await screen.findByText(/46 GB/);
        expect(line).toHaveTextContent('46 GB');
        expect(line.textContent).toMatch(/entered .*ago/);
    });
});

describe('scenario 22 — only the pick affordance is gated (D16 / E20)', () => {
    it('shows a roster member the waiting line and no Pick button', async () => {
        mount(makeReadiness({ canPick: false, pickerName: 'Roknua' }), makeSpeed());
        expect(await screen.findByText(/Waiting on Roknua to pick/)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /^Pick / })).not.toBeInTheDocument();
    });

    it('shows the creator one Pick button per tied game', async () => {
        mount(makeReadiness({ canPick: true }), makeSpeed());
        expect(await screen.findByRole('button', { name: 'Pick Deep Rock Galactic' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Pick Valheim' })).toBeInTheDocument();
    });
});

describe('scenario 23 — all-null sizes and speeds still render usefully (AC22)', () => {
    it('renders the ownership lines with no error state and no axe violations', async () => {
        const { container } = mount(
            makeReadiness({ viewerSpeedMbps: null }),
            makeSpeed({ downstreamMbps: null, measuredAt: null, consentAt: null }),
        );
        expect(await screen.findByText(/7 of 9 on the roster own it/)).toBeInTheDocument();
        expect(screen.getByText(/5 of 9 on the roster own it/)).toBeInTheDocument();
        expect(screen.getAllByText(/Size unknown/)).toHaveLength(2);
        expect(screen.queryAllByRole('alert')).toHaveLength(0);
        expect(await axe(container)).toHaveNoViolations();
    });
});
