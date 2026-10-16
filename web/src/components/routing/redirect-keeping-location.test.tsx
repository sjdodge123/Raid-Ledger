/**
 * ROK-1797 — the legacy `/profile/preferences/notifications` redirect must keep
 * the DM's `?type=` and `#notif-<type>` anchor, which a bare `<Navigate>` drops.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { RedirectKeepingLocation } from './redirect-keeping-location';

function LocationProbe() {
    const { pathname, search, hash } = useLocation();
    return <output data-testid="location">{`${pathname}${search}${hash}`}</output>;
}

function renderAt(url: string) {
    return render(
        <MemoryRouter initialEntries={[url]}>
            <Routes>
                <Route path="/profile/preferences/notifications"
                    element={<RedirectKeepingLocation to="/profile/notifications" />} />
                <Route path="*" element={<LocationProbe />} />
            </Routes>
        </MemoryRouter>,
    );
}

describe('RedirectKeepingLocation', () => {
    it('forwards both the query string and the hash', () => {
        renderAt('/profile/preferences/notifications?type=event_reminder#notif-event_reminder');
        expect(screen.getByTestId('location'))
            .toHaveTextContent('/profile/notifications?type=event_reminder#notif-event_reminder');
    });

    it('redirects a bare legacy path to the bare new path', () => {
        renderAt('/profile/preferences/notifications');
        expect(screen.getByTestId('location')).toHaveTextContent(/^\/profile\/notifications$/);
    });
});
