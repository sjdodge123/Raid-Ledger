/**
 * ROK-1374 — the pick controls' lock-in countdown.
 *
 * The countdown is a one-shot: it counts down to the grace deadline and then
 * has nothing left to say. An interval that keeps firing every second after
 * that re-renders the card forever, on every open lineup page, for a number
 * that will never change again.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, screen } from '@testing-library/react';
import type { TieReadinessGameDto, TiePickDto } from '@raid-ledger/contract';
import { renderWithProviders } from '../../../test/render-helpers';
import { TiePickControls } from './TiePickControls';

afterEach(() => {
    vi.useRealTimers();
});

function makeGame(): TieReadinessGameDto {
    return {
        gameId: 11,
        gameName: 'Deep Rock Galactic',
        gameCoverUrl: null,
        voteCount: 4,
        steamAppId: null,
        ownedCount: 7,
        rosterSize: 9,
        youOwn: true,
        installSizeBytes: null,
        downloadSizeBytes: null,
        installSizeSource: null,
        installSizeUpdatedAt: null,
        estimatedDownloadMinutes: null,
    };
}

function makePick(finalInMs: number): TiePickDto {
    return {
        gameId: 11,
        at: new Date().toISOString(),
        byUserId: 7,
        byUsername: 'Roknua',
        finalAt: new Date(Date.now() + finalInMs).toISOString(),
    };
}

function mountPicked(finalInMs: number) {
    return renderWithProviders(
        <TiePickControls
            lineupId={7}
            games={[makeGame()]}
            canPick
            pick={makePick(finalInMs)}
            pickerName="Roknua"
            expiresAt={null}
        />,
    );
}

describe('the lock-in countdown', () => {
    it('counts down while the grace claim is live', async () => {
        vi.useFakeTimers();
        mountPicked(3_000);
        expect(screen.getByText(/locks in 3s/)).toBeInTheDocument();
        await act(() => vi.advanceTimersByTimeAsync(1_000));
        expect(screen.getByText(/locks in 2s/)).toBeInTheDocument();
    });

    it('stops ticking once the deadline has passed', async () => {
        vi.useFakeTimers();
        mountPicked(2_000);
        await act(() => vi.advanceTimersByTimeAsync(3_000));

        expect(screen.getByText(/locking in/)).toBeInTheDocument();
        expect(vi.getTimerCount()).toBe(0);
    });
});
