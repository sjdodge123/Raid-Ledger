import { describe, it, expect, vi, beforeEach } from 'vitest';
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

describe('JoinPage', () => {
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

    describe('authenticated user — successful redemption', () => {
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
