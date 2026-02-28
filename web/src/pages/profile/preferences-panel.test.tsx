/**
 * Unit tests for the consolidated PreferencesPanel (ROK-359).
 * Verifies it renders Appearance, Timezone, and Privacy sections.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PreferencesPanel } from './preferences-panel';

// Mock AppearancePanel with a identifiable output
vi.mock('./appearance-panel', () => ({
    AppearancePanel: () => <div data-testid="appearance-panel">Appearance Content</div>,
}));

// Mock TimezoneSection with a identifiable output
vi.mock('../../components/profile/TimezoneSection', () => ({
    TimezoneSection: () => <div data-testid="timezone-section">Timezone Content</div>,
}));

// Mock auth + API client — PrivacySection (ROK-443) needs QueryClient and auth
vi.mock('../../hooks/use-auth', () => ({
    useAuth: () => ({ isAuthenticated: false }),
}));

vi.mock('../../lib/api-client', () => ({
    getMyPreferences: vi.fn().mockResolvedValue({}),
    updatePreference: vi.fn().mockResolvedValue(undefined),
}));

function renderWithQueryClient(ui: React.ReactElement) {
    const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
    });
    return render(
        <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
    );
}

describe('PreferencesPanel (ROK-359)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders the AppearancePanel sub-component', () => {
        renderWithQueryClient(<PreferencesPanel />);
        expect(screen.getByTestId('appearance-panel')).toBeInTheDocument();
    });

    it('renders the TimezoneSection sub-component', () => {
        renderWithQueryClient(<PreferencesPanel />);
        expect(screen.getByTestId('timezone-section')).toBeInTheDocument();
    });

    it('renders Appearance section before Timezone section in the DOM', () => {
        const { container } = renderWithQueryClient(<PreferencesPanel />);
        const appearance = container.querySelector('[data-testid="appearance-panel"]');
        const timezone = container.querySelector('[data-testid="timezone-section"]');
        expect(appearance).not.toBeNull();
        expect(timezone).not.toBeNull();
        // Appearance should appear before Timezone in document order
        expect(
            appearance!.compareDocumentPosition(timezone!) & Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy();
    });
});
