import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CommunityIdentityStep } from './community-identity-step';

vi.mock('../../../hooks/use-onboarding', () => ({
    useOnboarding: vi.fn(() => ({
        updateCommunity: { mutate: vi.fn(), isPending: false },
    })),
}));

vi.mock('../../../hooks/use-branding', () => ({
    useBranding: vi.fn(() => ({
        brandingQuery: { data: null },
        uploadLogo: { mutate: vi.fn(), isPending: false },
    })),
}));

vi.mock('../../../lib/config', () => ({
    API_BASE_URL: 'http://localhost:3000',
}));

vi.mock('../../../constants/timezones', () => ({
    TIMEZONE_AUTO: '__auto__',
    TIMEZONE_OPTIONS: [
        { id: 'America/New_York', label: 'Eastern Time', group: 'Americas' },
        { id: 'America/Los_Angeles', label: 'Pacific Time', group: 'Americas' },
    ],
    TIMEZONE_GROUPS: ['Americas'],
    getBrowserTimezone: vi.fn(() => 'America/New_York'),
}));

vi.mock('../../../lib/timezone-utils', () => ({
    getTimezoneAbbr: vi.fn(() => 'EST'),
}));

function createQueryClient() {
    return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderWithProviders(ui: React.ReactElement) {
    return render(
        <QueryClientProvider client={createQueryClient()}>
            {ui}
        </QueryClientProvider>
    );
}

describe('CommunityIdentityStep', () => {
    const mockOnNext = vi.fn();
    const mockOnBack = vi.fn();
    const mockOnSkip = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('Rendering', () => {
        it('renders the Community Identity heading', () => {
            renderWithProviders(
                <CommunityIdentityStep onNext={mockOnNext} onBack={mockOnBack} onSkip={mockOnSkip} />
            );
            expect(screen.getByText(/community identity/i)).toBeInTheDocument();
        });

        it('renders the community name input', () => {
            renderWithProviders(
                <CommunityIdentityStep onNext={mockOnNext} onBack={mockOnBack} onSkip={mockOnSkip} />
            );
            expect(screen.getByPlaceholderText(/midnight raiders/i)).toBeInTheDocument();
        });

        it('renders the timezone dropdown', () => {
            renderWithProviders(
                <CommunityIdentityStep onNext={mockOnNext} onBack={mockOnBack} onSkip={mockOnSkip} />
            );
            expect(screen.getByRole('combobox')).toBeInTheDocument();
        });
    });

    describe('Input width (full-width on mobile, max-width on desktop)', () => {
        it('community name input has w-full for mobile full-width', () => {
            const { container } = renderWithProviders(
                <CommunityIdentityStep onNext={mockOnNext} onBack={mockOnBack} onSkip={mockOnSkip} />
            );
            const nameInput = container.querySelector('input[type="text"]');
            expect(nameInput).not.toBeNull();
            expect(nameInput!.className).toContain('w-full');
        });

        it('community name input has sm:max-w-md for desktop constraint', () => {
            const { container } = renderWithProviders(
                <CommunityIdentityStep onNext={mockOnNext} onBack={mockOnBack} onSkip={mockOnSkip} />
            );
            const nameInput = container.querySelector('input[type="text"]');
            expect(nameInput!.className).toContain('sm:max-w-md');
        });

        it('timezone select has w-full for mobile full-width', () => {
            const { container } = renderWithProviders(
                <CommunityIdentityStep onNext={mockOnNext} onBack={mockOnBack} onSkip={mockOnSkip} />
            );
            const select = container.querySelector('select');
            expect(select!.className).toContain('w-full');
        });

        it('timezone select has sm:max-w-md for desktop constraint', () => {
            const { container } = renderWithProviders(
                <CommunityIdentityStep onNext={mockOnNext} onBack={mockOnBack} onSkip={mockOnSkip} />
            );
            const select = container.querySelector('select');
            expect(select!.className).toContain('sm:max-w-md');
        });
    });

    describe('Touch target compliance (min-h-[44px])', () => {
        it('community name input has min-h-[44px]', () => {
            const { container } = renderWithProviders(
                <CommunityIdentityStep onNext={mockOnNext} onBack={mockOnBack} onSkip={mockOnSkip} />
            );
            const nameInput = container.querySelector('input[type="text"]');
            expect(nameInput!.className).toContain('min-h-[44px]');
        });

        it('timezone select has min-h-[44px]', () => {
            const { container } = renderWithProviders(
                <CommunityIdentityStep onNext={mockOnNext} onBack={mockOnBack} onSkip={mockOnSkip} />
            );
            const select = container.querySelector('select');
            expect(select!.className).toContain('min-h-[44px]');
        });

        it('Upload Logo button has min-h-[44px]', () => {
            renderWithProviders(
                <CommunityIdentityStep onNext={mockOnNext} onBack={mockOnBack} onSkip={mockOnSkip} />
            );
            const uploadBtn = screen.getByRole('button', { name: /upload logo/i });
            expect(uploadBtn.className).toContain('min-h-[44px]');
        });

        it('Back button has min-h-[44px]', () => {
            renderWithProviders(
                <CommunityIdentityStep onNext={mockOnNext} onBack={mockOnBack} onSkip={mockOnSkip} />
            );
            const backBtn = screen.getByRole('button', { name: /^back$/i });
            expect(backBtn.className).toContain('min-h-[44px]');
        });

        it('Skip button has min-h-[44px]', () => {
            renderWithProviders(
                <CommunityIdentityStep onNext={mockOnNext} onBack={mockOnBack} onSkip={mockOnSkip} />
            );
            const skipBtn = screen.getByRole('button', { name: /^skip$/i });
            expect(skipBtn.className).toContain('min-h-[44px]');
        });

        it('Next button has min-h-[44px]', () => {
            renderWithProviders(
                <CommunityIdentityStep onNext={mockOnNext} onBack={mockOnBack} onSkip={mockOnSkip} />
            );
            const nextBtn = screen.getByRole('button', { name: /^next$/i });
            expect(nextBtn.className).toContain('min-h-[44px]');
        });
    });

    describe('Navigation', () => {
        it('Back button calls onBack', () => {
            renderWithProviders(
                <CommunityIdentityStep onNext={mockOnNext} onBack={mockOnBack} onSkip={mockOnSkip} />
            );
            fireEvent.click(screen.getByRole('button', { name: /^back$/i }));
            expect(mockOnBack).toHaveBeenCalledOnce();
        });

        it('Skip button calls onSkip', () => {
            renderWithProviders(
                <CommunityIdentityStep onNext={mockOnNext} onBack={mockOnBack} onSkip={mockOnSkip} />
            );
            fireEvent.click(screen.getByRole('button', { name: /^skip$/i }));
            expect(mockOnSkip).toHaveBeenCalledOnce();
        });

        it('Next button calls onNext when no changes', () => {
            renderWithProviders(
                <CommunityIdentityStep onNext={mockOnNext} onBack={mockOnBack} onSkip={mockOnSkip} />
            );
            fireEvent.click(screen.getByRole('button', { name: /^next$/i }));
            expect(mockOnNext).toHaveBeenCalledOnce();
        });
    });

    describe('Community name input', () => {
        it('shows character count', () => {
            renderWithProviders(
                <CommunityIdentityStep onNext={mockOnNext} onBack={mockOnBack} onSkip={mockOnSkip} />
            );
            expect(screen.getByText(/\/60/)).toBeInTheDocument();
        });

        it('login page preview shows community name', () => {
            renderWithProviders(
                <CommunityIdentityStep onNext={mockOnNext} onBack={mockOnBack} onSkip={mockOnSkip} />
            );
            const input = screen.getByPlaceholderText(/midnight raiders/i);
            fireEvent.change(input, { target: { value: 'Test Guild' } });
            expect(screen.getByText('Test Guild')).toBeInTheDocument();
        });

        it('preview shows "Raid Ledger" as default when name is empty', () => {
            renderWithProviders(
                <CommunityIdentityStep onNext={mockOnNext} onBack={mockOnBack} onSkip={mockOnSkip} />
            );
            expect(screen.getByText('Raid Ledger')).toBeInTheDocument();
        });
    });
});
