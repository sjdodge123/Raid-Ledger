/**
 * Profile nav — the Calendars entry (ROK-1594) is listed only while the
 * Calendar Sync kill switch is on, in the sidebar AND the More drawer
 * (both build from `getSections`).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { server } from '../../test/mocks/server';
import { renderWithProviders } from '../../test/render-helpers';
import { calendarsOverviewVariants, userCalendarHandlers } from '../../test/mocks/calendar-sync-handlers';
import { CALENDARS_PATH, getSections } from './profile-nav-data';
import { ProfileSidebar } from './profile-sidebar';

function gamingPaths(calendars: boolean): string[] {
    return getSections(1, { calendars }).find((s) => s.id === 'gaming')!.children.map((c) => c.to);
}

describe('profile nav — Calendars entry (ROK-1594)', () => {
    beforeEach(() => localStorage.setItem('raid_ledger_token', 'test-token'));
    afterEach(() => localStorage.removeItem('raid_ledger_token'));

    it('getSections lists Calendars right after Game Time only when on', () => {
        expect(gamingPaths(true)).toEqual([
            '/profile/gaming/game-time', CALENDARS_PATH, '/profile/gaming/characters', '/profile/gaming/watched-games',
        ]);
        expect(gamingPaths(false)).not.toContain(CALENDARS_PATH);
        expect(getSections(1).find((s) => s.id === 'gaming')!.children.map((c) => c.to)).not.toContain(CALENDARS_PATH);
    });

    it('sidebar shows the Calendars link when the overview says enabled', async () => {
        server.use(...userCalendarHandlers(calendarsOverviewVariants.available));
        renderWithProviders(<ProfileSidebar />);
        expect(await screen.findByRole('link', { name: /Calendars/ })).toHaveAttribute('href', CALENDARS_PATH);
    });

    it('sidebar hides the Calendars link when the switch is off', async () => {
        server.use(...userCalendarHandlers(calendarsOverviewVariants.disabled));
        renderWithProviders(<ProfileSidebar />);
        await waitFor(() => expect(screen.getByRole('link', { name: /Characters/ })).toBeInTheDocument());
        expect(screen.queryByRole('link', { name: /Calendars/ })).toBeNull();
    });
});
