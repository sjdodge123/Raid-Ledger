/**
 * ROK-1891 — old `/guilds/:id…` links (Discord embeds, stored notification
 * URLs, bookmarks) must land on the `/hubs/` equivalent with the query string
 * and the `#tab` fragment intact.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { LegacyHubRedirect } from './legacy-hub-redirect';
import { hubPathFromLegacy } from './hub-paths';

function LocationProbe() {
    const { pathname, search, hash } = useLocation();
    return <output data-testid="location">{`${pathname}${search}${hash}`}</output>;
}

function renderAt(url: string) {
    return render(
        <MemoryRouter initialEntries={[url]}>
            <Routes>
                <Route path="/guilds/:id" element={<LegacyHubRedirect />} />
                <Route path="/guilds/:id/*" element={<LegacyHubRedirect />} />
                <Route path="*" element={<LocationProbe />} />
            </Routes>
        </MemoryRouter>,
    );
}

describe('LegacyHubRedirect', () => {
    it('sends /guilds/7 to /hubs/7', () => {
        renderAt('/guilds/7');
        expect(screen.getByTestId('location')).toHaveTextContent(/^\/hubs\/7$/);
    });

    it('keeps a sub-path under /hubs/', () => {
        renderAt('/guilds/7/settings');
        expect(screen.getByTestId('location')).toHaveTextContent(/^\/hubs\/7\/settings$/);
    });

    it('keeps the ?post= query and the #tab fragment', () => {
        renderAt('/guilds/7?post=31#posts');
        expect(screen.getByTestId('location')).toHaveTextContent(/^\/hubs\/7\?post=31#posts$/);
    });

    it('keeps a bare #tab fragment', () => {
        renderAt('/guilds/310#characters');
        expect(screen.getByTestId('location')).toHaveTextContent(/^\/hubs\/310#characters$/);
    });
});

describe('hubPathFromLegacy', () => {
    it('rewrites only a leading /guilds/ segment', () => {
        expect(hubPathFromLegacy('/guilds/12')).toBe('/hubs/12');
        expect(hubPathFromLegacy('/hubs/12')).toBe('/hubs/12');
        expect(hubPathFromLegacy('/plugins/wow/guilds/12')).toBe('/plugins/wow/guilds/12');
    });
});
