/** ROK-2187 — the GG summary never shows a zero tile, and counts of one read singular. */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { GgSummaryFace, type GgSummaryFaceProps } from './gg-summary-face';

const BASE: GgSummaryFaceProps = {
    year: 2026, displayName: 'Kestrel', eventsAttended: 4, hoursPlayedSeconds: 12 * 3600,
    topGames: [{ name: 'Valheim' }], playedWithCount: 3, superlative: null,
};

describe('GgSummaryFace (ROK-2187)', () => {
    it('renders all three tiles with plural labels when every value is above one', () => {
        render(<GgSummaryFace {...BASE} />);
        expect(screen.getByText('events')).toBeInTheDocument();
        expect(screen.getByText('12h')).toBeInTheDocument();
        expect(screen.getByText('people played with')).toBeInTheDocument();
    });

    it('omits every tile whose value is zero (a short GG never shows 0)', () => {
        render(<GgSummaryFace {...BASE} eventsAttended={0} hoursPlayedSeconds={0} playedWithCount={2} />);
        expect(screen.queryByText(/^events?$/)).toBeNull();
        expect(screen.queryByText('played')).toBeNull();
        expect(screen.queryByText('0')).toBeNull();
        expect(screen.queryByText('0h')).toBeNull();
        expect(screen.getByText('people played with')).toBeInTheDocument();
    });

    it('omits the hours tile when the rounded hours would read 0h', () => {
        render(<GgSummaryFace {...BASE} hoursPlayedSeconds={600} />);
        expect(screen.queryByText('0h')).toBeNull();
    });

    it('reads singular for counts of one', () => {
        render(<GgSummaryFace {...BASE} eventsAttended={1} playedWithCount={1} />);
        expect(screen.getByText('event')).toBeInTheDocument();
        expect(screen.getByText('person played with')).toBeInTheDocument();
        expect(screen.queryByText('events')).toBeNull();
    });
});
