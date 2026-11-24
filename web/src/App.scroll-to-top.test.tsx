/**
 * ROK-2303: ScrollToTop skips only the flagged "Back to Calendar" PUSH (the
 * phone Day view restores its own scroll); every other PUSH still scrolls to top.
 */
import { useEffect, type JSX, type ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { RESTORE_DAY_SCROLL_STATE } from './components/calendar/day-scroll-restore-flag';

const { passthrough } = vi.hoisted(() => ({
    passthrough: ({ children }: { children?: ReactNode }) => children,
}));
vi.mock('./app-routes', () => ({ AppRoutes: () => null }));
vi.mock('./idle-prefetch', () => ({ prefetchDeferredChunksOnIdle: () => {} }));
vi.mock('./components/layout', () => ({ Layout: passthrough }));
vi.mock('./components/ui/StartupGate', () => ({ StartupGate: passthrough }));
vi.mock('./components/auth/ClaimGate', () => ({ ClaimGate: passthrough }));
vi.mock('./components/ui/ConnectivityBanner', () => ({ ConnectivityBanner: () => null }));
vi.mock('./components/ui/ThemeParticles', () => ({ ThemeParticles: () => null }));
vi.mock('./plugins/wow/register', () => ({}));
vi.mock('./plugins/discord/register', () => ({}));
vi.mock('./plugins/ai/register', () => ({}));
vi.mock('./plugins/pelican/register', () => ({}));

import { ScrollToTop } from './App';

function PushToCalendar({ flagged }: { flagged: boolean }): null {
    const navigate = useNavigate();
    useEffect(() => { void navigate('/calendar', flagged ? { state: RESTORE_DAY_SCROLL_STATE } : {}); }, [navigate, flagged]);
    return null;
}

function EventThenCalendar({ flagged }: { flagged: boolean }): JSX.Element {
    return (
        <MemoryRouter initialEntries={['/events/1']}>
            <ScrollToTop />
            <Routes>
                <Route path="/events/1" element={<PushToCalendar flagged={flagged} />} />
                <Route path="/calendar" element={null} />
            </Routes>
        </MemoryRouter>
    );
}

describe('ScrollToTop', () => {
    let scrollTo: ReturnType<typeof vi.spyOn>;
    beforeEach(() => { scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {}); });
    afterEach(() => { vi.restoreAllMocks(); });

    it('scrolls to top on an unflagged PUSH (desktop, Month, Schedule "Back to Calendar")', () => {
        render(<EventThenCalendar flagged={false} />);

        expect(scrollTo).toHaveBeenLastCalledWith(0, 0);
        expect(scrollTo).toHaveBeenCalledTimes(1);
    });

    it('leaves the window alone on the flagged phone Day "Back to Calendar" PUSH', () => {
        render(<EventThenCalendar flagged />);

        expect(scrollTo).not.toHaveBeenCalled();
    });
});
