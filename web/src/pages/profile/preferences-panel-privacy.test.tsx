/**
 * Unit tests for PrivacySection in PreferencesPanel (ROK-443).
 * Tests the show_activity toggle: default state, toggling, mutation, and label text.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PreferencesPanel } from './preferences-panel';

// ─── Mock sub-components to isolate PrivacySection ───────────────────────────

vi.mock('./appearance-panel', () => ({
    AppearancePanel: () => <div data-testid="appearance-panel" />,
}));

vi.mock('../../components/profile/TimezoneSection', () => ({
    TimezoneSection: () => <div data-testid="timezone-section" />,
}));

// ─── Mock API client ──────────────────────────────────────────────────────────

const mockGetMyPreferences = vi.fn();
const mockUpdatePreference = vi.fn();

vi.mock('../../lib/api-client', () => ({
    getMyPreferences: (...args: unknown[]) => mockGetMyPreferences(...args),
    updatePreference: (...args: unknown[]) => mockUpdatePreference(...args),
}));

// ─── Mock auth hook ───────────────────────────────────────────────────────────

vi.mock('../../hooks/use-auth', () => ({
    useAuth: () => ({ isAuthenticated: true }),
}));

// ─── Test helpers ─────────────────────────────────────────────────────────────

function renderPreferencesPanel(prefs: Record<string, unknown> = {}) {
    mockGetMyPreferences.mockResolvedValue(prefs);
    mockUpdatePreference.mockResolvedValue(undefined);

    const queryClient = new QueryClient({
        defaultOptions: {
            queries: { retry: false },
            mutations: { retry: false },
        },
    });

    return render(
        <QueryClientProvider client={queryClient}>
            <PreferencesPanel />
        </QueryClientProvider>,
    );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('PreferencesPanel — PrivacySection (ROK-443)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('PrivacySection renders correctly', () => {
        it('renders the Privacy section heading', async () => {
            renderPreferencesPanel({ show_activity: true });

            await waitFor(() => {
                expect(screen.getByText('Privacy')).toBeInTheDocument();
            });
        });

        it('renders descriptive subtitle text', async () => {
            renderPreferencesPanel({ show_activity: true });

            await waitFor(() => {
                expect(
                    screen.getByText('Control what others can see on your profile'),
                ).toBeInTheDocument();
            });
        });

        it('renders the show activity label', async () => {
            renderPreferencesPanel({ show_activity: true });

            await waitFor(() => {
                expect(
                    screen.getByText('Show my game activity publicly'),
                ).toBeInTheDocument();
            });
        });

        it('renders the show activity help text', async () => {
            renderPreferencesPanel({ show_activity: true });

            await waitFor(() => {
                expect(
                    screen.getByText(/When disabled, your game activity is hidden/i),
                ).toBeInTheDocument();
            });
        });

        it('renders the PrivacySection in the PreferencesPanel', () => {
            const { container } = renderPreferencesPanel();

            // Verify the panel renders overall
            expect(container.querySelector('[data-testid="appearance-panel"]')).toBeInTheDocument();
            expect(container.querySelector('[data-testid="timezone-section"]')).toBeInTheDocument();
        });
    });

    describe('checkbox default state', () => {
        it('is checked by default when show_activity is true', async () => {
            renderPreferencesPanel({ show_activity: true });

            await waitFor(() => {
                const checkbox = screen.getByRole('checkbox');
                expect(checkbox).toBeChecked();
            });
        });

        it('is checked by default when show_activity preference is not set (default=true)', async () => {
            renderPreferencesPanel({});

            await waitFor(() => {
                const checkbox = screen.getByRole('checkbox');
                expect(checkbox).toBeChecked();
            });
        });

        it('is unchecked when show_activity is false', async () => {
            renderPreferencesPanel({ show_activity: false });

            await waitFor(() => {
                const checkbox = screen.getByRole('checkbox');
                expect(checkbox).not.toBeChecked();
            });
        });
    });

    describe('toggling the preference', () => {
        it('calls updatePreference with false when unchecking the checkbox', async () => {
            const user = userEvent.setup();
            renderPreferencesPanel({ show_activity: true });

            await waitFor(() => {
                expect(screen.getByRole('checkbox')).toBeInTheDocument();
            });

            const checkbox = screen.getByRole('checkbox');
            await user.click(checkbox);

            await waitFor(() => {
                expect(mockUpdatePreference).toHaveBeenCalledWith('show_activity', false);
            });
        });

        it('calls updatePreference with true when checking the checkbox', async () => {
            const user = userEvent.setup();
            renderPreferencesPanel({ show_activity: false });

            await waitFor(() => {
                expect(screen.getByRole('checkbox')).toBeInTheDocument();
            });

            const checkbox = screen.getByRole('checkbox');
            await user.click(checkbox);

            await waitFor(() => {
                expect(mockUpdatePreference).toHaveBeenCalledWith('show_activity', true);
            });
        });

        it('calls updatePreference with the correct key show_activity', async () => {
            const user = userEvent.setup();
            renderPreferencesPanel({ show_activity: true });

            await waitFor(() => {
                expect(screen.getByRole('checkbox')).toBeInTheDocument();
            });

            await user.click(screen.getByRole('checkbox'));

            await waitFor(() => {
                expect(mockUpdatePreference).toHaveBeenCalledWith(
                    'show_activity',
                    expect.any(Boolean),
                );
            });
        });
    });

    describe('PrivacySection appears in correct position', () => {
        it('renders after AppearancePanel and TimezoneSection', async () => {
            const { container } = renderPreferencesPanel({ show_activity: true });

            await waitFor(() => {
                expect(screen.getByText('Privacy')).toBeInTheDocument();
            });

            const appearance = container.querySelector('[data-testid="appearance-panel"]');
            const timezone = container.querySelector('[data-testid="timezone-section"]');
            const privacySection = screen.getByText('Privacy').closest('div.bg-surface');

            expect(appearance).not.toBeNull();
            expect(timezone).not.toBeNull();
            expect(privacySection).not.toBeNull();

            // Privacy section should appear after appearance and timezone in DOM order
            expect(
                appearance!.compareDocumentPosition(privacySection!) & Node.DOCUMENT_POSITION_FOLLOWING,
            ).toBeTruthy();

            expect(
                timezone!.compareDocumentPosition(privacySection!) & Node.DOCUMENT_POSITION_FOLLOWING,
            ).toBeTruthy();
        });
    });
});
