/**
 * Profile nav — ROK-1780 moved Calendars inline onto My Integrations, so the
 * Gaming section no longer lists a Calendars entry (it was ROK-1594's
 * kill-switch-gated item), in the sidebar AND the More drawer (both build
 * from `getSections`) — even while Calendar Sync is switched on.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { server } from '../../test/mocks/server';
import { renderWithProviders } from '../../test/render-helpers';
import { calendarsOverviewVariants, userCalendarHandlers } from '../../test/mocks/calendar-sync-handlers';
import { getSections } from './profile-nav-data';
import { ProfileSidebar } from './profile-sidebar';
import { setAccessToken, clearAccessToken } from '../../lib/api/access-token-store';

describe('profile nav — no Gaming → Calendars entry (ROK-1780)', () => {
    beforeEach(() => setAccessToken('test-token'));
    afterEach(() => clearAccessToken());

    it('getSections lists Game Time, Characters, Watched Games under Gaming; Integrations keeps My Integrations', () => {
        const sections = getSections(1);
        expect(sections.find((s) => s.id === 'gaming')?.children.map((c) => c.to)).toEqual([
            '/profile/gaming/game-time', '/profile/gaming/characters', '/profile/gaming/watched-games',
        ]);
        expect(sections.find((s) => s.id === 'integrations')?.children).toEqual([
            { to: '/profile/integrations', label: 'My Integrations' },
        ]);
        const allPaths = sections.flatMap((s) => s.children.map((c) => c.to));
        expect(allPaths.filter((p) => p.includes('calendars'))).toEqual([]);
    });

    it('sidebar shows no Calendars link even when Calendar Sync is enabled', async () => {
        server.use(...userCalendarHandlers(calendarsOverviewVariants.connected));
        renderWithProviders(<ProfileSidebar />);
        await waitFor(() => expect(screen.getByRole('link', { name: /Characters/ })).toBeInTheDocument());
        expect(screen.getByRole('link', { name: /My Integrations/ })).toHaveAttribute('href', '/profile/integrations');
        expect(screen.queryByRole('link', { name: /^Calendars$/ })).toBeNull();
    });
});
