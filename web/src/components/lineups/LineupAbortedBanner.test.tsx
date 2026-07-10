/**
 * Tests for LineupAbortedBanner (ROK-1207).
 *
 * The banner is the dominant visual cue on the detail page when a lineup
 * has been aborted. It renders the operator-supplied reason when one was
 * captured (`metadata.reason` on the `lineup_aborted` activity entry), and
 * falls back to generic copy when no reason was provided.
 */
import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../test/render-helpers';
import { LineupAbortedBanner } from './LineupAbortedBanner';

describe('LineupAbortedBanner', () => {
    it('renders the cancellation copy and the reason when one was supplied', () => {
        renderWithProviders(
            <LineupAbortedBanner
                abortedAt="2026-04-28T15:00:00Z"
                reason="Roster fell apart"
            />,
        );

        expect(
            screen.getByTestId('lineup-aborted-banner'),
        ).toBeInTheDocument();
        // role="status" carries an implicit polite live region; the explicit
        // aria-live attribute is redundant and must stay absent.
        const banner = screen.getByRole('status');
        expect(banner).not.toHaveAttribute('aria-live');
        expect(screen.getByText(/this lineup was cancelled/i)).toBeInTheDocument();
        expect(screen.getByText(/reason/i)).toBeInTheDocument();
        expect(
            screen.getByTestId('lineup-aborted-reason'),
        ).toHaveTextContent('Roster fell apart');
    });

    it('renders generic copy when reason is null', () => {
        renderWithProviders(
            <LineupAbortedBanner
                abortedAt="2026-04-28T15:00:00Z"
                reason={null}
            />,
        );

        expect(
            screen.getByTestId('lineup-aborted-banner'),
        ).toBeInTheDocument();
        expect(screen.getByText(/no reason was provided/i)).toBeInTheDocument();
        expect(
            screen.queryByTestId('lineup-aborted-reason'),
        ).not.toBeInTheDocument();
    });

    it('returns null when abortedAt is null (lineup is still active)', () => {
        const { container } = renderWithProviders(
            <LineupAbortedBanner abortedAt={null} reason={null} />,
        );

        expect(container.firstChild).toBeNull();
        expect(
            screen.queryByTestId('lineup-aborted-banner'),
        ).not.toBeInTheDocument();
    });

    it('returns null when abortedAt is null even if a reason is somehow present', () => {
        // Defensive: spec says abortedAt is the single source of truth.
        const { container } = renderWithProviders(
            <LineupAbortedBanner
                abortedAt={null}
                reason="should not be rendered"
            />,
        );

        expect(container.firstChild).toBeNull();
    });
});
