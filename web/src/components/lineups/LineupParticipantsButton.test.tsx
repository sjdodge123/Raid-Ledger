/**
 * ROK-1557 AC1/AC3 — the hero participants button on a scheduling poll.
 *
 * It must ask the server for the MATCH roster (`?matchId=`) rather than the
 * lineup's nomination-phase roster, and it must refetch when the modal opens
 * so a viewer who just voted does not read a stale "Waiting" chip.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/render-helpers';
import { LineupParticipantsButton } from './LineupParticipantsButton';

const getLineupParticipantsMock = vi.fn();

vi.mock('../../lib/api-client', () => ({
    getLineupParticipants: (...args: unknown[]) =>
        getLineupParticipantsMock(...args),
}));

const ROSTER = {
    participants: [
        {
            userId: 7,
            displayName: 'Voter',
            avatar: null,
            customAvatarUrl: null,
            discordId: null,
            role: 'participant' as const,
            status: 'voted' as const,
            steamLinked: false,
        },
    ],
};

describe('LineupParticipantsButton', () => {
    beforeEach(() => {
        getLineupParticipantsMock.mockReset();
        getLineupParticipantsMock.mockResolvedValue(ROSTER);
    });

    it('fetches the match roster when a matchId is given', async () => {
        renderWithProviders(
            <LineupParticipantsButton lineupId={5} matchId={12} />,
        );

        await waitFor(() =>
            expect(getLineupParticipantsMock).toHaveBeenCalledWith(5, 12),
        );
        expect(
            await screen.findByRole('button', { name: /Participants, 1/ }),
        ).toBeInTheDocument();
    });

    it('refetches the roster when the modal opens', async () => {
        const user = userEvent.setup();
        renderWithProviders(
            <LineupParticipantsButton lineupId={5} matchId={12} />,
        );

        await waitFor(() =>
            expect(getLineupParticipantsMock).toHaveBeenCalledTimes(1),
        );

        await user.click(screen.getByTestId('lineup-participants-button'));

        await waitFor(() =>
            expect(getLineupParticipantsMock).toHaveBeenCalledTimes(2),
        );
        expect(screen.getByText('Voted')).toBeInTheDocument();
    });
});

/**
 * ROK-1582: the chip is a hero badge-row control on a phone too — a 10px
 * ~22px-tall pill is below the 44px touch target minimum. It grows on a
 * phone and keeps its compact desktop size from `sm` up.
 */
describe('LineupParticipantsButton — phone target size (ROK-1582)', () => {
    it('keeps the shipped compact pill by default (every other hero + the archived header)', async () => {
        renderWithProviders(<LineupParticipantsButton lineupId={5} />);
        const btn = await screen.findByTestId('lineup-participants-button');
        const classes = Array.from(btn.classList);
        expect(classes).toContain('text-[10px]');
        expect(classes).toContain('py-0.5');
        expect(classes).not.toContain('min-h-[44px]');
    });

    it('is a 44px target with text-sm below lg and stays compact from lg up when size="touch"', async () => {
        renderWithProviders(
            <LineupParticipantsButton lineupId={5} matchId={12} size="touch" />,
        );
        const btn = await screen.findByTestId('lineup-participants-button');
        const classes = Array.from(btn.classList);

        expect(classes).toContain('min-h-[44px]');
        expect(classes).toContain('text-sm');
        expect(classes).toContain('lg:min-h-0');
        expect(classes).toContain('lg:text-[10px]');
        // Still the pill that opens the participants modal.
        expect(classes).toContain('rounded-full');
        expect(btn.getAttribute('aria-label')).toMatch(/Participants/);
    });
});
