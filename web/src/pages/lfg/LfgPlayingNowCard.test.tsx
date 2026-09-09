/**
 * ROK-1494 AC3 — the group page's playing-now card.
 *
 * The card is the ONLY thing on the page that says a spawned session exists:
 * once the intents converted, `activeCount` is 0 and every other surface reads
 * as an empty group. Both links are asserted by `href`, not by label alone,
 * because a viewer who cannot reach the voice channel or the event has been
 * told about a session they cannot join.
 */
import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../test/render-helpers';
import { createMockLfgPlayingNow } from '../../test/lfg-factories';
import { LfgPlayingNowCard } from './LfgPlayingNowCard';

describe('LfgPlayingNowCard', () => {
    it('renders nothing when the group has no live session', () => {
        const { container } = renderWithProviders(
            <LfgPlayingNowCard playingNow={null} />,
        );

        expect(screen.queryByTestId('lfg-playing-now')).toBeNull();
        expect(container).toBeEmptyDOMElement();
    });

    it('names the session and the live head-count', () => {
        renderWithProviders(
            <LfgPlayingNowCard
                playingNow={createMockLfgPlayingNow({ participantCount: 3 })}
            />,
        );

        expect(screen.getByTestId('lfg-playing-now')).toBeInTheDocument();
        expect(screen.getByText('Playing now')).toBeInTheDocument();
        expect(screen.getByTestId('lfg-playing-now-count')).toHaveTextContent(
            '3 in voice',
        );
    });

    it('links to the spawned event by id', () => {
        renderWithProviders(
            <LfgPlayingNowCard
                playingNow={createMockLfgPlayingNow({ eventId: 4242 })}
            />,
        );

        const link = screen.getByTestId('lfg-playing-now-event');
        expect(link).toHaveAttribute('href', '/events/4242');
        expect(link).toHaveTextContent('Open the event');
    });

    it('links to the Discord voice channel the spawn created', () => {
        const invite =
            'https://discord.com/channels/800000000000000001/900000000000000001';
        renderWithProviders(
            <LfgPlayingNowCard
                playingNow={createMockLfgPlayingNow({ voiceInviteUrl: invite })}
            />,
        );

        const link = screen.getByTestId('lfg-playing-now-voice');
        expect(link).toHaveAttribute('href', invite);
        expect(link).toHaveTextContent('Join voice');
    });

    it('still renders the card in the window before the voice channel exists', () => {
        // The temp channel is created AFTER the spawn transaction commits
        // (contract D9), so a read can legitimately land on "event yes,
        // channel not yet" — the card must not vanish or crash there.
        renderWithProviders(
            <LfgPlayingNowCard
                playingNow={createMockLfgPlayingNow({
                    voiceChannelId: null,
                    voiceInviteUrl: null,
                })}
            />,
        );

        expect(screen.getByTestId('lfg-playing-now')).toBeInTheDocument();
        expect(screen.getByTestId('lfg-playing-now-event')).toBeInTheDocument();
        expect(screen.queryByTestId('lfg-playing-now-voice')).toBeNull();
    });
});
