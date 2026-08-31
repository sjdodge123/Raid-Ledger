/**
 * ROK-1444 (Codex P3) — roster-fit flags on the MOBILE nominations list.
 *
 * `ExistingNominations` is `hidden md:block`, so this drawer is the only
 * nominations list below the md breakpoint. Without a participant count
 * threaded through, outgrown co-op picks would be flagged on desktop and
 * silently unflagged on mobile.
 */
import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../../../test/render-helpers';
import { createMockEntry } from '../../../../test/lineup-factories';
import { MyNominationsDrawer } from '../MyNominationsDrawer';

function renderDrawer(participantCount?: number, onlineMax: number | null = 4) {
    renderWithProviders(
        <MyNominationsDrawer
            isOpen={true}
            onClose={vi.fn()}
            entries={[createMockEntry({ cooptimusOnlineMax: onlineMax })]}
            lineupId={7}
            participantCount={participantCount}
        />,
    );
}

describe('MyNominationsDrawer — roster fit (ROK-1444)', () => {
    it('flags a nomination the group has outgrown', () => {
        renderDrawer(6);
        expect(screen.getByTestId('nomination-fit-warning')).toHaveTextContent(
            /Fits 4 online · group is 6/,
        );
    });

    it('does not flag a game that still fits', () => {
        renderDrawer(4);
        expect(
            screen.queryByTestId('nomination-fit-warning'),
        ).not.toBeInTheDocument();
    });

    it('stays silent when the roster size is unknown', () => {
        renderDrawer(undefined);
        expect(
            screen.queryByTestId('nomination-fit-warning'),
        ).not.toBeInTheDocument();
    });

    it('stays silent for a never-synced game', () => {
        renderDrawer(99, null);
        expect(
            screen.queryByTestId('nomination-fit-warning'),
        ).not.toBeInTheDocument();
    });
});
