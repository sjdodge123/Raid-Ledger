/**
 * ROK-2187 L3c — the year visuals render only when the payload carries their
 * (optional) data: Events → month histogram, Reliability → week strip, and the
 * Hubs card's backdrop comes from its first https game-art URL.
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { GgEventsCardView, GgOnTimeCardView } from './core-stat-cards';
import { ggHubsBackdrop } from './register-core-gg-cards';

const events = { signedUp: 5, attended: 4, noShows: 1, firstEventAt: null, lastEventAt: null };
const onTime = { attended: 4, onTime: 3, onTimeRatio: 0.75 };

describe('Core GG stat cards — year visuals', () => {
    it('Events card draws 12 month bars, busiest month highlighted', () => {
        render(<GgEventsCardView year={2026} payload={{ ...events, eventsByMonth: [1, 0, 3, 0, 0, 0, 0, 0, 0, 0, 0, 1] }} />);
        const bars = screen.getAllByTestId('gg-hist-bar');
        expect(bars).toHaveLength(12);
        expect(bars.map((b) => b.dataset.peak).indexOf('true')).toBe(2);
    });

    it('Events card shows no histogram for an older snapshot without eventsByMonth', () => {
        render(<GgEventsCardView year={2026} payload={events} />);
        expect(screen.queryAllByTestId('gg-hist-bar')).toHaveLength(0);
    });

    it('Reliability card draws the week strip with the longest streak ringed', () => {
        const weeks = Array.from({ length: 52 }, (_, i) => i >= 3 && i < 6);
        render(<GgOnTimeCardView year={2026} payload={{ ...onTime, weeksAttended: weeks }} />);
        const cells = screen.getAllByTestId('gg-week');
        expect(cells).toHaveLength(52);
        expect(cells.filter((c) => c.dataset.state === 'run')).toHaveLength(3);
        expect(screen.getByRole('img', { name: /3-week streak highlighted/ })).toBeInTheDocument();
    });

    it('Reliability card shows no strip without weeksAttended', () => {
        render(<GgOnTimeCardView year={2026} payload={onTime} />);
        expect(screen.queryAllByTestId('gg-week')).toHaveLength(0);
    });

    it('Hubs backdrop is the first game-art URL, else none', () => {
        const hubs = { joined: 1, posts: 2, pictures: 0 };
        expect(ggHubsBackdrop({ ...hubs, backdropUrls: ['https://a/1.jpg', 'https://a/2.jpg'] })).toBe('https://a/1.jpg');
        expect(ggHubsBackdrop(hubs)).toBeUndefined();
    });
});

describe('Core GG stat cards — no zero values, singular counts', () => {
    it('Events card hides the no-shows tile when there were none', () => {
        render(<GgEventsCardView year={2026} payload={{ ...events, noShows: 0 }} />);
        expect(screen.queryByText(/no-show/)).toBeNull();
    });

    it('Events card says "1 no-show" and "event" (singular) for counts of one', () => {
        render(<GgEventsCardView year={2026} payload={{ ...events, attended: 1, noShows: 1 }} />);
        expect(screen.getByText('no-show')).toBeInTheDocument();
        expect(screen.getByText('event')).toBeInTheDocument();
        expect(screen.queryByText('events')).toBeNull();
    });

    it('Events card keeps plurals for counts above one', () => {
        render(<GgEventsCardView year={2026} payload={{ ...events, noShows: 2 }} />);
        expect(screen.getByText('no-shows')).toBeInTheDocument();
        expect(screen.getByText('events')).toBeInTheDocument();
    });
});
