import { describe, it, expect } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderWithProviders } from '../../test/render-helpers';
import { CalendarSyncInstructions } from './calendar-sync-instructions';

const CONSOLE = 'https://console.cloud.google.com';

describe('CalendarSyncInstructions', () => {
    it('links every Google console step to its page in a new tab', () => {
        renderWithProviders(<CalendarSyncInstructions />);
        const box = screen.getByTestId('calendar-sync-instructions');
        const cases: [string, string][] = [
            ['Create a project', `${CONSOLE}/projectcreate`],
            ['Google Calendar API', `${CONSOLE}/apis/library/calendar-json.googleapis.com`],
            ['Google Auth Platform', `${CONSOLE}/auth/overview`],
            ['Audience', `${CONSOLE}/auth/audience`],
            ['Create OAuth client', `${CONSOLE}/auth/clients/create`],
        ];
        for (const [name, href] of cases) {
            const link = within(box).getByRole('link', { name });
            expect(link).toHaveAttribute('href', href);
            expect(link).toHaveAttribute('target', '_blank');
            expect(link).toHaveAttribute('rel', 'noopener noreferrer');
        }
    });

    it('points members at the profile Calendars page', () => {
        renderWithProviders(<CalendarSyncInstructions />);
        expect(screen.getByRole('link', { name: /Profile → Gaming → Calendars/ }))
            .toHaveAttribute('href', '/profile/gaming/calendars');
    });

    it('lists seven steps', () => {
        renderWithProviders(<CalendarSyncInstructions />);
        expect(within(screen.getByTestId('calendar-sync-instructions')).getAllByRole('listitem')).toHaveLength(7);
    });
});
