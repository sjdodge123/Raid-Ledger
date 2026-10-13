/**
 * ROK-1780 — the old Profile → Gaming → Calendars URLs redirect onto My
 * Integrations, KEEPING the query string so an OAuth callback that lands on
 * the old path still shows its `?connected=` toast / `?error=` banner.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { LegacyCalendarsRedirect, LegacySendEventsRedirect } from './calendar-legacy-redirects';

function LocationProbe() {
    const loc = useLocation();
    return <span data-testid="location">{loc.pathname + loc.search}</span>;
}

function renderAt(url: string) {
    return render(
        <MemoryRouter initialEntries={[url]}>
            <Routes>
                <Route path="/profile/gaming/calendars" element={<LegacyCalendarsRedirect />} />
                <Route path="/profile/gaming/calendars/send/:connectionId" element={<LegacySendEventsRedirect />} />
                <Route path="/profile/integrations" element={<LocationProbe />} />
                <Route path="/profile/integrations/calendars/send/:connectionId" element={<LocationProbe />} />
            </Routes>
        </MemoryRouter>,
    );
}

describe('legacy Calendars redirects (ROK-1780)', () => {
    it.each([
        ['/profile/gaming/calendars', '/profile/integrations'],
        ['/profile/gaming/calendars?connected=google', '/profile/integrations?connected=google'],
        ['/profile/gaming/calendars?error=state', '/profile/integrations?error=state'],
        ['/profile/gaming/calendars/send/7', '/profile/integrations/calendars/send/7'],
        ['/profile/gaming/calendars/send/7?x=1', '/profile/integrations/calendars/send/7?x=1'],
    ])('%s → %s', async (from, to) => {
        renderAt(from);
        expect((await screen.findByTestId('location')).textContent).toBe(to);
    });
});
