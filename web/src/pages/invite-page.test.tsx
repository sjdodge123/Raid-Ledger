import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { InvitePage } from './invite-page';

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('../lib/api-client', () => ({
    resolveInviteCode: vi.fn(),
    claimInviteCode: vi.fn(),
}));

vi.mock('../lib/toast', () => ({
    toast: {
        success: vi.fn(),
        info: vi.fn(),
        error: vi.fn(),
    },
}));

vi.mock('../components/ui/loading-spinner', () => ({
    LoadingSpinner: () => <div data-testid="loading-spinner" />,
}));

vi.mock('../lib/config', () => ({
    API_BASE_URL: 'http://localhost:3000',
}));

vi.mock('../lib/role-colors', () => ({
    formatRole: (role: string) => role.charAt(0).toUpperCase() + role.slice(1),
}));

vi.mock('../plugins/wow/components/wow-armory-import-form', () => ({
    WowArmoryImportForm: ({ onSuccess }: { onSuccess: () => void }) => (
        <button data-testid="wow-import-form" onClick={onSuccess}>
            Import Character
        </button>
    ),
}));

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
    const actual = await vi.importActual('react-router-dom');
    return {
        ...actual,
        useNavigate: () => mockNavigate,
    };
});

const mockUseAuth = vi.fn();
vi.mock('../hooks/use-auth', () => ({
    useAuth: () => mockUseAuth(),
}));

const mockUseMyCharacters = vi.fn();
vi.mock('../hooks/use-characters', () => ({
    useMyCharacters: () => mockUseMyCharacters(),
}));

import * as apiClient from '../lib/api-client';

// ── Helpers ───────────────────────────────────────────────────────────────────

function createQueryClient() {
    return new QueryClient({
        defaultOptions: { queries: { retry: false } },
    });
}

function renderInvitePage(code = 'test-code') {
    return render(
        <QueryClientProvider client={createQueryClient()}>
            <MemoryRouter initialEntries={[`/i/${code}`]}>
                <Routes>
                    <Route path="/i/:code" element={<InvitePage />} />
                    <Route path="/events/:id" element={<div>Event Page</div>} />
                    <Route path="/onboarding" element={<div>Onboarding Page</div>} />
                    <Route path="/calendar" element={<div>Calendar Page</div>} />
                </Routes>
            </MemoryRouter>
        </QueryClientProvider>,
    );
}

/** Minimal valid resolve response with a Discord invite URL */
function makeResolveData(overrides: Record<string, unknown> = {}) {
    return {
        valid: true,
        discordServerInviteUrl: 'https://discord.gg/test-server',
        communityName: 'Test Guild',
        event: {
            id: 42,
            title: 'Mythic Raid Night',
            startTime: '2026-03-01T20:00:00Z',
            game: {
                id: 1,
                name: 'World of Warcraft',
                coverUrl: null,
                registryId: 'wow-retail',
                isBlizzardGame: false,
                hasRoles: false,
                gameVariant: null,
                inviterRealm: null,
            },
        },
        ...overrides,
    };
}

/** Minimal valid claim result with Discord invite URL */
function makeClaimResult(overrides: Record<string, unknown> = {}) {
    return {
        type: 'signup' as const,
        eventId: 42,
        discordServerInviteUrl: 'https://discord.gg/test-server',
        ...overrides,
    };
}

// ── Test Suite ────────────────────────────────────────────────────────────────

describe('InvitePage — step 3 success screen (ROK-424)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockNavigate.mockReset();
        sessionStorage.clear();

        // Default: authenticated, no loading
        mockUseAuth.mockReturnValue({ isAuthenticated: true, isLoading: false });

        // Default: no characters
        mockUseMyCharacters.mockReturnValue({
            data: { data: [] },
            refetch: vi.fn().mockResolvedValue({ data: { data: [] } }),
        });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // Helper to reach step 3 (success screen) in tests
    // ─────────────────────────────────────────────────────────────────────────

    async function renderAtStep3(claimResultOverrides = {}, resolveOverrides = {}) {
        vi.mocked(apiClient.resolveInviteCode).mockResolvedValue(
            makeResolveData(resolveOverrides),
        );
        vi.mocked(apiClient.claimInviteCode).mockResolvedValue(
            makeClaimResult(claimResultOverrides),
        );

        renderInvitePage();

        // Wait for resolve to settle and step 2 to show
        const joinButton = await screen.findByRole('button', { name: /join event/i });
        fireEvent.click(joinButton);

        // Wait for step 3 success screen
        await screen.findByText(/you're all set/i);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // AC: Discord join button is primary CTA
    // ─────────────────────────────────────────────────────────────────────────

    describe('Discord join CTA is primary and dominant', () => {
        it('renders the Discord join button with btn-primary class', async () => {
            await renderAtStep3();

            const discordBtn = screen.getByRole('link', { name: /join.*discord/i });
            expect(discordBtn).toBeInTheDocument();
            expect(discordBtn.className).toContain('btn-primary');
        });

        it('Discord join button has the correct invite URL as href', async () => {
            await renderAtStep3();

            const discordBtn = screen.getByRole('link', { name: /join.*discord/i });
            expect(discordBtn).toHaveAttribute('href', 'https://discord.gg/test-server');
        });

        it('Discord join button opens in a new tab', async () => {
            await renderAtStep3();

            const discordBtn = screen.getByRole('link', { name: /join.*discord/i });
            expect(discordBtn).toHaveAttribute('target', '_blank');
            expect(discordBtn).toHaveAttribute('rel', 'noopener noreferrer');
        });

        it('includes community name in Discord button label when communityName is present', async () => {
            await renderAtStep3();

            // communityName is "Test Guild" → "Join Test Guild's Discord"
            expect(screen.getByRole('link', { name: /join test guild's discord/i })).toBeInTheDocument();
        });

        it('falls back to generic label when communityName is absent', async () => {
            await renderAtStep3({}, { communityName: undefined });

            expect(screen.getByRole('link', { name: /join discord server/i })).toBeInTheDocument();
        });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // AC: "View Event Details" button is removed from step 3
    // ─────────────────────────────────────────────────────────────────────────

    describe('"View Event Details" button is absent from success screen', () => {
        it('does not render a "View Event Details" button on step 3', async () => {
            await renderAtStep3();

            expect(screen.queryByRole('button', { name: /view event details/i })).not.toBeInTheDocument();
            expect(screen.queryByRole('link', { name: /view event details/i })).not.toBeInTheDocument();
        });

        it('does not navigate to the event page automatically after claim', async () => {
            await renderAtStep3();

            // After step 3 renders, navigate should NOT have been called with the event URL
            expect(mockNavigate).not.toHaveBeenCalledWith(
                expect.stringContaining('/events/'),
                expect.anything(),
            );
        });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // AC: "Continue to set up my Raid Ledger account →" text link present
    // ─────────────────────────────────────────────────────────────────────────

    describe('"Continue to set up my Raid Ledger account" link', () => {
        it('renders the onboarding text link on success screen', async () => {
            await renderAtStep3();

            const link = screen.getByRole('button', { name: /continue to set up my raid ledger account/i });
            expect(link).toBeInTheDocument();
        });

        it('clicking the onboarding link navigates to /onboarding', async () => {
            await renderAtStep3();

            const link = screen.getByRole('button', { name: /continue to set up my raid ledger account/i });
            fireEvent.click(link);

            expect(mockNavigate).toHaveBeenCalledWith('/onboarding', { replace: true });
        });

        it('onboarding link is visually de-emphasized (no btn class, has text-muted)', async () => {
            await renderAtStep3();

            const link = screen.getByRole('button', { name: /continue to set up my raid ledger account/i });
            // Must NOT have button chrome
            expect(link.className).not.toContain('btn-primary');
            expect(link.className).not.toContain('btn-secondary');
            // Must be muted
            expect(link.className).toContain('text-muted');
        });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // AC: Text link size changes based on showDiscordCta
    // ─────────────────────────────────────────────────────────────────────────

    describe('text link prominence by Discord CTA visibility', () => {
        it('uses text-xs when Discord CTA is shown (de-emphasized)', async () => {
            // Discord invite URL present → showDiscordCta = true
            await renderAtStep3();

            const link = screen.getByRole('button', { name: /continue to set up my raid ledger account/i });
            expect(link.className).toContain('text-xs');
            expect(link.className).not.toContain('text-sm');
        });

        it('uses text-sm when Discord CTA is hidden (more prominent)', async () => {
            // No Discord invite URL → showDiscordCta = false
            vi.mocked(apiClient.resolveInviteCode).mockResolvedValue(
                makeResolveData({ discordServerInviteUrl: undefined }),
            );
            vi.mocked(apiClient.claimInviteCode).mockResolvedValue(
                makeClaimResult({ discordServerInviteUrl: undefined }),
            );

            renderInvitePage();

            const joinButton = await screen.findByRole('button', { name: /join event/i });
            fireEvent.click(joinButton);
            await screen.findByText(/you're all set/i);

            const link = screen.getByRole('button', { name: /continue to set up my raid ledger account/i });
            expect(link.className).toContain('text-sm');
            expect(link.className).not.toContain('text-xs');
        });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // AC: Discord post-click checkmark state preserved
    // ─────────────────────────────────────────────────────────────────────────

    describe('Discord join button post-click checkmark state', () => {
        it('shows Discord join link before clicking', async () => {
            await renderAtStep3();

            expect(screen.getByRole('link', { name: /join.*discord/i })).toBeInTheDocument();
            expect(screen.queryByText(/discord invite opened/i)).not.toBeInTheDocument();
        });

        it('replaces Discord button with checkmark state after clicking', async () => {
            await renderAtStep3();

            const discordBtn = screen.getByRole('link', { name: /join.*discord/i });
            fireEvent.click(discordBtn);

            await waitFor(() => {
                expect(screen.queryByRole('link', { name: /join.*discord/i })).not.toBeInTheDocument();
            });
            expect(screen.getByText(/discord invite opened/i)).toBeInTheDocument();
        });

        it('onboarding link is still present after Discord join is clicked', async () => {
            await renderAtStep3();

            const discordBtn = screen.getByRole('link', { name: /join.*discord/i });
            fireEvent.click(discordBtn);

            await waitFor(() => {
                expect(screen.getByText(/discord invite opened/i)).toBeInTheDocument();
            });
            expect(
                screen.getByRole('button', { name: /continue to set up my raid ledger account/i }),
            ).toBeInTheDocument();
        });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // AC: No Discord CTA section when showDiscordCta is false
    // ─────────────────────────────────────────────────────────────────────────

    describe('when no Discord invite URL is present (showDiscordCta = false)', () => {
        async function renderStep3NoDiscord() {
            vi.mocked(apiClient.resolveInviteCode).mockResolvedValue(
                makeResolveData({ discordServerInviteUrl: undefined }),
            );
            vi.mocked(apiClient.claimInviteCode).mockResolvedValue(
                makeClaimResult({ discordServerInviteUrl: undefined }),
            );

            renderInvitePage();

            const joinButton = await screen.findByRole('button', { name: /join event/i });
            fireEvent.click(joinButton);
            await screen.findByText(/you're all set/i);
        }

        it('does not render Discord CTA block when no invite URL', async () => {
            await renderStep3NoDiscord();

            expect(screen.queryByRole('link', { name: /join.*discord/i })).not.toBeInTheDocument();
            expect(screen.queryByText(/join the discord server/i)).not.toBeInTheDocument();
        });

        it('still renders the onboarding link when Discord CTA is absent', async () => {
            await renderStep3NoDiscord();

            expect(
                screen.getByRole('button', { name: /continue to set up my raid ledger account/i }),
            ).toBeInTheDocument();
        });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // Success screen general content
    // ─────────────────────────────────────────────────────────────────────────

    describe('success screen general content', () => {
        it('shows "You\'re all set!" heading on step 3', async () => {
            await renderAtStep3();

            expect(screen.getByRole('heading', { name: /you're all set/i })).toBeInTheDocument();
        });

        it('shows event title on success screen', async () => {
            await renderAtStep3();

            expect(screen.getByText('Mythic Raid Night')).toBeInTheDocument();
        });

        it('shows confirmation message about Discord DM', async () => {
            await renderAtStep3();

            expect(screen.getByText(/discord dm/i)).toBeInTheDocument();
        });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // Step 1 still has "View Event Details" (unrelated, should not regress)
    // ─────────────────────────────────────────────────────────────────────────

    describe('step 1 (unauthenticated) — View Event Details survives', () => {
        it('shows "View Event Details" button on step 1 for unauthenticated users', async () => {
            mockUseAuth.mockReturnValue({ isAuthenticated: false, isLoading: false });
            vi.mocked(apiClient.resolveInviteCode).mockResolvedValue(makeResolveData());

            renderInvitePage();

            await screen.findByText(/sign in with discord to join/i);

            expect(
                screen.getByRole('button', { name: /view event details/i }),
            ).toBeInTheDocument();
        });
    });
});
