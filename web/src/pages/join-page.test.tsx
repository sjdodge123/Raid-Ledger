import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { JoinPage } from './join-page';

// Mock API client
vi.mock('../lib/api-client', () => ({
    redeemIntent: vi.fn(),
}));

// Mock toast
vi.mock('../lib/toast', () => ({
    toast: {
        success: vi.fn(),
        info: vi.fn(),
        error: vi.fn(),
    },
}));

// Mock LoadingSpinner
vi.mock('../components/ui/loading-spinner', () => ({
    LoadingSpinner: () => <div data-testid="loading-spinner" />,
}));

// Mock config
vi.mock('../lib/config', () => ({
    API_BASE_URL: 'http://localhost:3000',
}));

// Mock navigate
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
    const actual = await vi.importActual('react-router-dom');
    return {
        ...actual,
        useNavigate: () => mockNavigate,
    };
});

// ROK-1839: the intent token is captured and stripped from the address bar
// before Sentry initialises, so JoinPage falls back to the capture when the
// URL no longer carries one. Mocked here to keep the fallback deterministic.
interface FakeCapture { token: string; eventId: string | null; intent: string | null; capturedAt: number }
const capture = vi.hoisted(() => ({ current: null as FakeCapture | null }));
const mockClearCaptured = vi.hoisted(() => vi.fn());
const mockSetCaptured = vi.hoisted(() => vi.fn());
vi.mock('../lib/query-token-capture', () => ({
    peekCapturedQueryToken: () => capture.current,
    setCapturedQueryToken: (entry: Omit<FakeCapture, 'capturedAt'>) => {
        mockSetCaptured(entry);
        capture.current = { ...entry, capturedAt: 0 };
    },
    clearCapturedQueryToken: () => {
        mockClearCaptured();
        capture.current = null;
    },
}));

/** A capture taken for `/join?intent=signup&eventId=<eventId>`. */
function captureFor(eventId: string | null, token = 'captured.intent.token', intent: string | null = 'signup'): FakeCapture {
    return { token, eventId, intent, capturedAt: 0 };
}

// Mock useAuth
const mockUseAuth = vi.fn();
vi.mock('../hooks/use-auth', () => ({
    useAuth: () => mockUseAuth(),
}));

import * as apiClient from '../lib/api-client';
import * as toastModule from '../lib/toast';

/** Render JoinPage with given URL query params */
function renderJoinPage(search: string = '') {
    return render(
        <MemoryRouter initialEntries={[`/join${search}`]}>
            <Routes>
                <Route path="/join" element={<JoinPage />} />
                <Route path="/calendar" element={<div>Calendar Page</div>} />
                <Route path="/events/:id" element={<div>Event Page</div>} />
            </Routes>
        </MemoryRouter>,
    );
}

describe('JoinPage — part 1', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockNavigate.mockReset();
        // Clear sessionStorage
        sessionStorage.clear();
        // Default: auth loading
        mockUseAuth.mockReturnValue({ isAuthenticated: false, isLoading: false });
    });

    // ============================================================

    // Invalid link rendering

    // ============================================================

    describe('invalid link rendering', () => {
        it('should show "Invalid Link" heading when no query params', () => {
            renderJoinPage();

            expect(screen.getByRole('heading', { name: /invalid link/i })).toBeInTheDocument();
        });

        it('should show "Invalid Link" when intent is missing', () => {
            renderJoinPage('?eventId=42&token=sometoken');

            expect(screen.getByRole('heading', { name: /invalid link/i })).toBeInTheDocument();
        });

        it('should show "Invalid Link" when eventId is missing', () => {
            renderJoinPage('?intent=signup&token=sometoken');

            expect(screen.getByRole('heading', { name: /invalid link/i })).toBeInTheDocument();
        });

        it('should show "Invalid Link" when token is missing', () => {
            renderJoinPage('?intent=signup&eventId=42');

            expect(screen.getByRole('heading', { name: /invalid link/i })).toBeInTheDocument();
        });

        it('should show "Invalid Link" when intent is not "signup"', () => {
            renderJoinPage('?intent=other&eventId=42&token=sometoken');

            expect(screen.getByRole('heading', { name: /invalid link/i })).toBeInTheDocument();
        });

        it('should show "Go to Calendar" button on invalid link', () => {
            renderJoinPage();

            expect(screen.getByRole('button', { name: /go to calendar/i })).toBeInTheDocument();
        });

        it('should navigate to /calendar when "Go to Calendar" is clicked', async () => {
            renderJoinPage();

            fireEvent.click(screen.getByRole('button', { name: /go to calendar/i }));

            expect(mockNavigate).toHaveBeenCalledWith('/calendar');
        });

        it('should show descriptive error message on invalid link', () => {
            renderJoinPage();

            expect(
                screen.getByText(/invalid or has expired/i),
            ).toBeInTheDocument();
        });
    });

    // ============================================================

    // Auth loading state

    // ============================================================

    describe('auth loading state', () => {
        it('should show loading spinner while auth is loading', () => {
            mockUseAuth.mockReturnValue({ isAuthenticated: false, isLoading: true });
            renderJoinPage('?intent=signup&eventId=42&token=valid-token');

            expect(screen.getByTestId('loading-spinner')).toBeInTheDocument();
        });
    });

    // ============================================================

    // Unauthenticated user redirect

    // ============================================================

});

describe('JoinPage — part 2', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockNavigate.mockReset();
        // Clear sessionStorage
        sessionStorage.clear();
        // Default: auth loading
        mockUseAuth.mockReturnValue({ isAuthenticated: false, isLoading: false });
    });

    describe('unauthenticated user', () => {
        it('should store intent in sessionStorage and redirect to Discord OAuth', async () => {
            mockUseAuth.mockReturnValue({ isAuthenticated: false, isLoading: false });

            // Mock window.location.href setter
            const hrefSetter = vi.fn();
            Object.defineProperty(window, 'location', {
                value: { ...window.location },
                writable: true,
            });
            Object.defineProperty(window.location, 'href', {
                set: hrefSetter,
                get: () => 'http://localhost/',
                configurable: true,
            });

            renderJoinPage('?intent=signup&eventId=42&token=my-token');

            await waitFor(() => {
                const stored = sessionStorage.getItem('join_intent');
                expect(stored).toBeTruthy();
            });

            const intent = JSON.parse(sessionStorage.getItem('join_intent')!);
            expect(intent.eventId).toBe('42');
            expect(intent.token).toBe('my-token');
        });

        it('should show "Redirecting to Discord login..." text', () => {
            mockUseAuth.mockReturnValue({ isAuthenticated: false, isLoading: false });

            renderJoinPage('?intent=signup&eventId=42&token=my-token');

            expect(
                screen.getByText(/redirecting to discord login/i),
            ).toBeInTheDocument();
        });
    });

    // ============================================================

    // Authenticated user — redeem intent

    // ============================================================

});

describe('authenticated user — successful redemption — sub 1', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockNavigate.mockReset();
        // Clear sessionStorage
        sessionStorage.clear();
        // Default: auth loading
        mockUseAuth.mockReturnValue({ isAuthenticated: false, isLoading: false });
    });

    it('should call redeemIntent with token when authenticated', async () => {
        mockUseAuth.mockReturnValue({ isAuthenticated: true, isLoading: false });
        vi.mocked(apiClient.redeemIntent).mockResolvedValueOnce({
            success: true,
            eventId: 42,
            message: "You're signed up!",
        });

        renderJoinPage('?intent=signup&eventId=42&token=valid-token');

        await waitFor(() => {
            expect(apiClient.redeemIntent).toHaveBeenCalledWith('valid-token');
        });
    });

    it('should show success toast and navigate to event page on success', async () => {
        mockUseAuth.mockReturnValue({ isAuthenticated: true, isLoading: false });
        vi.mocked(apiClient.redeemIntent).mockResolvedValueOnce({
            success: true,
            eventId: 42,
            message: "You're signed up!",
        });

        renderJoinPage('?intent=signup&eventId=42&token=valid-token');

        await waitFor(() => {
            expect(mockNavigate).toHaveBeenCalledWith('/events/42', { replace: true });
        });

        expect(toastModule.toast.success).toHaveBeenCalledWith(
            expect.stringContaining("signed up"),
            expect.any(Object),
        );
    });

});

describe('authenticated user — successful redemption — sub 2', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockNavigate.mockReset();
        // Clear sessionStorage
        sessionStorage.clear();
        // Default: auth loading
        mockUseAuth.mockReturnValue({ isAuthenticated: false, isLoading: false });
    });

    it('should show info toast and navigate to event page when token is expired', async () => {
        mockUseAuth.mockReturnValue({ isAuthenticated: true, isLoading: false });
        vi.mocked(apiClient.redeemIntent).mockResolvedValueOnce({
            success: false,
            eventId: 42,
            message: 'Intent token is invalid, expired, or already used',
        });

        renderJoinPage('?intent=signup&eventId=42&token=expired-token');

        await waitFor(() => {
            expect(mockNavigate).toHaveBeenCalledWith('/events/42', { replace: true });
        });

        expect(toastModule.toast.info).toHaveBeenCalledWith(
            expect.stringContaining('expired'),
            expect.any(Object),
        );
    });

    it('should navigate to event page even when redeemIntent throws', async () => {
        mockUseAuth.mockReturnValue({ isAuthenticated: true, isLoading: false });
        vi.mocked(apiClient.redeemIntent).mockRejectedValueOnce(
            new Error('Network error'),
        );

        renderJoinPage('?intent=signup&eventId=42&token=bad-token');

        await waitFor(() => {
            expect(mockNavigate).toHaveBeenCalledWith('/events/42', { replace: true });
        });
    });

});

describe('JoinPage — part 4', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockNavigate.mockReset();
        // Clear sessionStorage
        sessionStorage.clear();
        // Default: auth loading
        mockUseAuth.mockReturnValue({ isAuthenticated: false, isLoading: false });
    });

    // ============================================================

    // Processing state display

    // ============================================================

    describe('processing state display', () => {
        it('should show "Processing your signup..." when authenticated and processing', () => {
            mockUseAuth.mockReturnValue({ isAuthenticated: true, isLoading: false });
            // Delay resolution so we can observe the loading state
            vi.mocked(apiClient.redeemIntent).mockImplementation(
                () => new Promise(() => {}), // never resolves
            );

            renderJoinPage('?intent=signup&eventId=42&token=valid-token');

            expect(screen.getByText(/processing your signup/i)).toBeInTheDocument();
            expect(screen.getByTestId('loading-spinner')).toBeInTheDocument();
        });
    });

    // ============================================================

    // Single-use (processedRef)

    // ============================================================

    describe('single-use guard', () => {
        it('should not call redeemIntent multiple times for same render', async () => {
            mockUseAuth.mockReturnValue({ isAuthenticated: true, isLoading: false });
            vi.mocked(apiClient.redeemIntent).mockResolvedValue({
                success: true,
                eventId: 42,
                message: "You're signed up!",
            });

            renderJoinPage('?intent=signup&eventId=42&token=valid-token');

            await waitFor(() => {
                expect(apiClient.redeemIntent).toHaveBeenCalledTimes(1);
            });
        });
    });

});

describe('ROK-1839: the intent token comes from the pre-Sentry capture', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockNavigate.mockReset();
        sessionStorage.clear();
        capture.current = null;
        mockUseAuth.mockReturnValue({ isAuthenticated: true, isLoading: false });
    });

    it('redeems the captured token when the address bar no longer carries one', async () => {
        capture.current = captureFor('42');
        vi.mocked(apiClient.redeemIntent).mockResolvedValueOnce({
            success: true, eventId: 42, message: "You're signed up!",
        });

        renderJoinPage('?intent=signup&eventId=42');

        await waitFor(() => {
            expect(apiClient.redeemIntent).toHaveBeenCalledWith('captured.intent.token');
        });
        expect(mockClearCaptured, 'a redeemed token must not survive the exchange').toHaveBeenCalled();
    });

    it('hands the captured token to the Discord hop and clears it when signed out', async () => {
        mockUseAuth.mockReturnValue({ isAuthenticated: false, isLoading: false });
        capture.current = captureFor('42');

        renderJoinPage('?intent=signup&eventId=42');

        await waitFor(() => {
            expect(JSON.parse(sessionStorage.getItem('join_intent') ?? 'null')).toEqual({
                intent: 'signup', eventId: '42', token: 'captured.intent.token',
            });
        });
        expect(mockClearCaptured).toHaveBeenCalled();
    });

    it('still shows the invalid-link state when neither the URL nor the capture has a token', () => {
        renderJoinPage('?intent=signup&eventId=42');

        expect(screen.getByRole('heading', { name: /invalid link/i })).toBeInTheDocument();
        expect(apiClient.redeemIntent).not.toHaveBeenCalled();
    });
});

/**
 * ROK-1839 fix round r1. Codex P2 / Opus MINOR: the capture is bound to the
 * page it was taken for, and an unredeemed token never outlives the link
 * (Lead ruling 2).
 */
describe('ROK-1839: an unusable capture is ignored and dropped', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockNavigate.mockReset();
        sessionStorage.clear();
        capture.current = null;
        mockUseAuth.mockReturnValue({ isAuthenticated: true, isLoading: false });
    });

    it('ignores and clears a capture taken for a DIFFERENT event', async () => {
        capture.current = captureFor('99', 'other.events.token');

        renderJoinPage('?intent=signup&eventId=42');

        expect(
            screen.getByRole('heading', { name: /invalid link/i }),
            "a capture for event 99 must not be redeemed on event 42's page",
        ).toBeInTheDocument();
        expect(apiClient.redeemIntent, 'the wrong event\'s token is never redeemed').not.toHaveBeenCalled();
        await waitFor(() => expect(mockClearCaptured).toHaveBeenCalled());
        expect(capture.current, 'and it does not sit in the tab waiting for the next page').toBeNull();
    });

    it('ignores and clears a capture taken for a DIFFERENT intent', async () => {
        capture.current = captureFor('42', 'poll.intent.token', 'poll');

        renderJoinPage('?intent=signup&eventId=42');

        expect(screen.getByRole('heading', { name: /invalid link/i })).toBeInTheDocument();
        expect(apiClient.redeemIntent).not.toHaveBeenCalled();
        await waitFor(() => expect(mockClearCaptured).toHaveBeenCalled());
    });

    it('clears a matching capture when the link itself is invalid', async () => {
        capture.current = captureFor('42', 'captured.intent.token', 'other');

        renderJoinPage('?intent=other&eventId=42');

        expect(screen.getByRole('heading', { name: /invalid link/i })).toBeInTheDocument();
        await waitFor(() => expect(
            mockClearCaptured,
            'an abandoned/invalid link must not leave a live token in the tab',
        ).toHaveBeenCalled());
    });

    it('clears the token when the redeem is REJECTED, not just when it succeeds', async () => {
        capture.current = captureFor('42');
        vi.mocked(apiClient.redeemIntent).mockResolvedValueOnce({
            success: false, eventId: 42, message: 'Intent token is invalid, expired, or already used',
        });

        renderJoinPage('?intent=signup&eventId=42');

        await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/events/42', { replace: true }));
        expect(mockClearCaptured, 'a rejected token is spent too').toHaveBeenCalled();
        expect(capture.current).toBeNull();
    });

    it('clears the token when the redeem THROWS', async () => {
        capture.current = captureFor('42');
        vi.mocked(apiClient.redeemIntent).mockRejectedValueOnce(new Error('Network error'));

        renderJoinPage('?intent=signup&eventId=42');

        await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/events/42', { replace: true }));
        expect(mockClearCaptured, 'a token that errored out must not be replayable').toHaveBeenCalled();
    });
});

/**
 * ROK-1839 fix round r2 — Codex P2 (the cleanup read a stale snapshot) and
 * Opus M1 (the strip bypassed react-router). These drive the MOUNT strip, so
 * the jsdom address bar really carries a token; every other case in this file
 * leaves it clean and exercises the module-load capture instead.
 */
describe('ROK-1839 r2: the mount strip and the cleanup read ONE capture', () => {
    // An earlier case in this file permanently swapped `window.location` for a
    // plain object, so jsdom navigation no longer reaches it — stub the shape
    // the strip reads (`search`, `pathname`, `hash`) directly and restore it.
    const realLocation = window.location;
    const STRIPPED = '/join?intent=signup&eventId=42';
    const SEARCH = '?intent=signup&eventId=42&token=fresh.url.token';

    beforeEach(() => {
        vi.clearAllMocks();
        mockNavigate.mockReset();
        sessionStorage.clear();
        capture.current = null;
        mockUseAuth.mockReturnValue({ isAuthenticated: true, isLoading: false });
        // Never settles: the redeem's own clear must not mask the cleanup's.
        vi.mocked(apiClient.redeemIntent).mockImplementation(() => new Promise(() => {}));
        Object.defineProperty(window, 'location', {
            value: { pathname: '/join', search: SEARCH, hash: '', href: `http://localhost${STRIPPED}&token=fresh.url.token` },
            writable: true, configurable: true,
        });
    });

    afterEach(() => {
        Object.defineProperty(window, 'location', { value: realLocation, writable: true, configurable: true });
    });

    it('keeps the token the strip just captured, despite a stale foreign capture in the tab', async () => {
        // A leftover capture from an abandoned link for ANOTHER event is what
        // the render pass sees; the strip replaces it between render and
        // effects. The cleanup used to judge that stale value and wipe the
        // legitimate token the strip had just taken.
        capture.current = captureFor('99', 'abandoned.token');

        renderJoinPage(SEARCH);

        await waitFor(() => expect(mockSetCaptured).toHaveBeenCalledWith({
            token: 'fresh.url.token', eventId: '42', intent: 'signup',
        }));
        expect(
            mockClearCaptured,
            'the cleanup must not clear the capture the mount strip just took for this very page',
        ).not.toHaveBeenCalled();
        expect(
            capture.current?.token,
            'the freshly captured token has to survive the mount pass so a reload can still redeem it',
        ).toBe('fresh.url.token');
        expect(apiClient.redeemIntent).toHaveBeenCalledWith('fresh.url.token');
    });

    it('strips the token through the router, preserving the entry state', async () => {
        renderJoinPage(SEARCH);

        await waitFor(() => expect(
            mockNavigate,
            "a bare history.replaceState leaves ?token= in react-router's own location, where useSearchParams still reads it",
        ).toHaveBeenCalledWith(STRIPPED, { replace: true, state: null }));
    });
});


/**
 * ROK-1839 r3 (Codex P2). `resolveJoinToken` reads mutable, time-bound state,
 * so memoizing it on the URL fields froze a token the tab had already retired.
 * Auth settles on a LATER render than the one that first resolved the capture
 * — exactly the window an impersonation auto-end or a cross-tab logout lands
 * in (`use-auth.ts` clears the capture on both).
 */
describe('ROK-1839 r3: a capture retired while auth was pending is never redeemed', () => {
    // An earlier case in this file permanently swapped `window.location` for a
    // plain object; give the mount strip the shape it reads (token-free here,
    // so the strip is a no-op and only the capture is in play) and restore it.
    const realLocation = window.location;
    const SEARCH = '?intent=signup&eventId=42';

    beforeEach(() => {
        vi.clearAllMocks();
        mockNavigate.mockReset();
        sessionStorage.clear();
        capture.current = captureFor('42');
        // Never settles: an in-flight redeem must not clear anything itself.
        vi.mocked(apiClient.redeemIntent).mockImplementation(() => new Promise(() => {}));
        Object.defineProperty(window, 'location', {
            value: { pathname: '/join', search: SEARCH, hash: '', href: `http://localhost/join${SEARCH}` },
            writable: true, configurable: true,
        });
    });

    afterEach(() => {
        Object.defineProperty(window, 'location', { value: realLocation, writable: true, configurable: true });
    });

    it('drops a capture cleared mid-flight by an auto-ended impersonation', () => {
        mockUseAuth.mockReturnValue({ isAuthenticated: false, isLoading: true });
        // A FRESH element each pass: React bails out of re-rendering a
        // subtree handed the identical element object.
        const tree = () => (
            <MemoryRouter initialEntries={[`/join${SEARCH}`]}>
                <Routes>
                    <Route path="/join" element={<JoinPage />} />
                    <Route path="/calendar" element={<div>Calendar Page</div>} />
                    <Route path="/events/:id" element={<div>Event Page</div>} />
                </Routes>
            </MemoryRouter>
        );
        const { rerender } = render(tree());

        // What `use-auth` does when the impersonation ends itself.
        capture.current = null;
        mockUseAuth.mockReturnValue({ isAuthenticated: true, isLoading: false });
        rerender(tree());

        expect(
            vi.mocked(apiClient.redeemIntent).mock.calls,
            'the capture was retired before auth settled — the join effect must not spend it',
        ).toEqual([]);
        expect(
            screen.getByRole('heading', { name: /invalid link/i }),
            'with its only token gone, the page is an invalid link, not a spinner',
        ).toBeInTheDocument();
    });
});
