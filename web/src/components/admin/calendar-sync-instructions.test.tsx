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
            ['Branding', `${CONSOLE}/auth/branding`],
            ['Audience', `${CONSOLE}/auth/audience`],
            ['Create OAuth client', `${CONSOLE}/auth/clients/create`],
            ['Verification Center', `${CONSOLE}/auth/verification`],
        ];
        for (const [name, href] of cases) {
            const link = within(box).getByRole('link', { name });
            expect(link).toHaveAttribute('href', href);
            expect(link).toHaveAttribute('target', '_blank');
            expect(link).toHaveAttribute('rel', 'noopener noreferrer');
        }
    });

    it('points members at Profile → My Integrations, where Calendars render (ROK-1780)', () => {
        renderWithProviders(<CalendarSyncInstructions />);
        expect(screen.getByRole('link', { name: /Profile → My Integrations/ }))
            .toHaveAttribute('href', '/profile/integrations');
    });

    it('has the admin publish the app instead of listing members as test users', () => {
        renderWithProviders(<CalendarSyncInstructions />);
        const box = screen.getByTestId('calendar-sync-instructions');
        expect(within(box).getByText('Publish app')).toBeInTheDocument();
        expect(box).not.toHaveTextContent(/test users/i);
        expect(screen.getByTestId('calendar-sync-unverified-note')).toHaveTextContent(/up to 100 people/);
    });

    it('lists eight steps', () => {
        renderWithProviders(<CalendarSyncInstructions />);
        expect(within(screen.getByTestId('calendar-sync-instructions')).getAllByRole('listitem')).toHaveLength(8);
    });

    it('ROK-1778: fills in Branding right before publishing, skipping the logo and pasting the privacy link', () => {
        renderWithProviders(<CalendarSyncInstructions />);
        const steps = within(screen.getByTestId('calendar-sync-instructions')).getAllByRole('listitem');
        const branding = steps.findIndex((li) => li.textContent?.startsWith('Fill in the Branding page.'));
        const publish = steps.findIndex((li) => li.textContent?.startsWith('Let any member connect.'));
        expect(branding).toBeGreaterThan(-1);
        expect(publish).toBe(branding + 1);
        const step = steps[branding];
        expect(step).toHaveTextContent('Skip the App logo: adding one sends your branding to Google for review.');
        expect(step).toHaveTextContent(/Privacy policy link shown below into Application privacy policy link/);
        expect(step).toHaveTextContent(/Authorized domains/);
    });
});
