import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../test/render-helpers';
import { EventsPageHeader } from './EventsPageHeader';

/**
 * TDB:2050 (ruling D:1721): the "Schedule a Game" CTA is bg-cyan-700 / hover cyan-800 with a
 * forced-white label in BOTH families — white 5.28 / 7.22:1. The old bg-cyan-600 +
 * text-foreground was 3.46:1 in default-dark (#f8fafc label) and 2.26:1 on its cyan-500 hover;
 * text-foreground on cyan-700 would be #0f172a on light, 3.38:1.
 */
describe('EventsPageHeader — Schedule a Game CTA contrast (TDB:2050)', () => {
    it('paints cyan-700 with a cyan-800 hover and a forced-white label', () => {
        renderWithProviders(<EventsPageHeader activeTab="upcoming" filteredGameName={null} isAuthenticated />);
        const cta = screen.getByRole('button', { name: /schedule a game/i });
        expect(cta, 'cyan-600 is 3.46:1 under the dark label — the ruling is bg-cyan-700 hover:bg-cyan-800').toHaveClass(
            'bg-cyan-700',
            'hover:bg-cyan-800',
            'text-white',
        );
        expect(cta, 'text-foreground goes #0f172a on light (3.38:1 on cyan-700) — the label must be text-white').not.toHaveClass(
            'text-foreground',
        );
    });
});
