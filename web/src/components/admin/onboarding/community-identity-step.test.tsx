import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CommunityIdentityStep } from './community-identity-step';
import { LOGO_ACCEPT_MIME } from '../../../constants/branding';

const mocks = vi.hoisted(() => ({
    updateMutate: vi.fn(),
    uploadMutate: vi.fn(),
    state: { updatePending: false, uploadPending: false },
}));

vi.mock('../../../hooks/use-onboarding', () => ({
    useOnboarding: vi.fn(() => ({
        updateCommunity: { mutate: mocks.updateMutate, isPending: mocks.state.updatePending },
    })),
}));

vi.mock('../../../hooks/use-branding', () => ({
    useBranding: vi.fn(() => ({
        brandingQuery: { data: null },
        uploadLogo: { mutate: mocks.uploadMutate, isPending: mocks.state.uploadPending },
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

/** The Field wrapper that labels `control` (its `<label for>`'s parent). */
function fieldOf(control: Element): HTMLElement {
    const label = document.querySelector(`label[for="${control.id}"]`);
    expect(label, `a <label for> naming #${control.id}`).not.toBeNull();
    return label!.parentElement!;
}

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
        mocks.state.updatePending = false;
        mocks.state.uploadPending = false;
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

        it('gives the name input and timezone select accessible names (ROK-1645)', () => {
            renderWithProviders(
                <CommunityIdentityStep onNext={mockOnNext} onBack={mockOnBack} onSkip={mockOnSkip} />
            );
            expect(screen.getByRole('textbox', { name: 'Community name' })).toBeInTheDocument();
            expect(screen.getByRole('combobox', { name: 'Default timezone' })).toBeInTheDocument();
        });
    });

    // ROK-1648: the sm:max-w-md cap sits on the Field wrapper (as in
    // secure-account-step), so label, control and hint share one width; the
    // control itself stays w-full inside it.
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
            expect(fieldOf(nameInput!).className).toContain('sm:max-w-md');
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
            expect(fieldOf(select!).className).toContain('sm:max-w-md');
        });
    });

    function touchTargetComplianceMinHGroup1() {
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

    }

    function touchTargetComplianceMinHGroup2() {
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

    }

    describe('Touch target compliance (min-h-[44px])', () => {
        touchTargetComplianceMinHGroup1();
        touchTargetComplianceMinHGroup2();
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

function renderStep(onNext = vi.fn()) {
    return renderWithProviders(<CommunityIdentityStep onNext={onNext} onBack={vi.fn()} onSkip={vi.fn()} />);
}

describe('CommunityIdentityStep — Field + Input + Select (ROK-1648)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.state.updatePending = false;
        mocks.state.uploadPending = false;
    });

    it('labels the name input through a Field and wires the n/60 counter as its hint', () => {
        renderStep();
        const input = screen.getByRole('textbox', { name: 'Community name' });
        expect(fieldOf(input)).toBeInTheDocument();
        expect(input).toHaveAttribute('maxLength', '60');
        expect(input).toHaveAccessibleDescription('0/60');
        fireEvent.change(input, { target: { value: 'Test Guild' } });
        expect(input).toHaveAccessibleDescription('10/60');
    });

    it('labels the timezone Select through a Field and keeps its optgroups', () => {
        const { container } = renderStep();
        const select = screen.getByRole('combobox', { name: 'Default timezone' });
        expect(fieldOf(select)).toBeInTheDocument();
        expect(select.querySelector('option')).toHaveValue('__auto__');
        const group = container.querySelector('optgroup[label="Americas"]');
        expect(group).not.toBeNull();
        expect(Array.from(group!.querySelectorAll('option')).map((o) => o.value))
            .toEqual(['America/New_York', 'America/Los_Angeles']);
    });

    it('Back / Skip / Next are shared Buttons (no raw disabled:bg-emerald-800 fill)', () => {
        renderStep();
        for (const name of [/^back$/i, /^skip$/i, /^next$/i]) {
            const btn = screen.getByRole('button', { name });
            expect(btn.querySelector('[data-button-label]'), `${name} is a Button`).not.toBeNull();
            expect(btn.className).not.toContain('disabled:bg-emerald-800');
        }
    });
});

describe('CommunityIdentityStep — FilePicker + loading Buttons (ROK-1648, ruling 7)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.state.updatePending = false;
        mocks.state.uploadPending = false;
    });

    it('the logo FilePicker keeps a native input that accepts LOGO_ACCEPT_MIME and uploads the pick', async () => {
        const { container } = renderStep();
        const fileInput = container.querySelector<HTMLInputElement>('input[type=file]');
        expect(fileInput).not.toBeNull();
        expect(fileInput!.accept).toBe(LOGO_ACCEPT_MIME);
        const openPicker = vi.spyOn(fileInput!, 'click');
        fireEvent.click(screen.getByRole('button', { name: /upload logo/i }));
        expect(openPicker).toHaveBeenCalledOnce();
        const file = new File(['png'], 'logo.png', { type: 'image/png' });
        await userEvent.upload(fileInput!, file);
        expect(mocks.uploadMutate).toHaveBeenCalledExactlyOnceWith(file);
        expect(fileInput!.value).toBe('');
    });

    it('Upload Logo is aria-busy while uploading, and the picker does not open', () => {
        mocks.state.uploadPending = true;
        const { container } = renderStep();
        const btn = screen.getByRole('button', { name: /uploading/i });
        expect(btn).toHaveAttribute('aria-busy', 'true');
        expect(btn).toHaveAttribute('aria-disabled', 'true');
        expect(container.querySelector('input[type=file]')).toBeDisabled();
    });

    it('Next is aria-busy while saving and swallows the click', () => {
        mocks.state.updatePending = true;
        const onNext = vi.fn();
        renderStep(onNext);
        const next = screen.getByRole('button', { name: /saving/i });
        expect(next).toHaveAttribute('aria-busy', 'true');
        expect(next).toHaveAttribute('aria-disabled', 'true');
        fireEvent.click(next);
        expect(onNext).not.toHaveBeenCalled();
        expect(mocks.updateMutate).not.toHaveBeenCalled();
    });

    it('Next saves a typed name, then advances on success', () => {
        const onNext = vi.fn();
        renderStep(onNext);
        fireEvent.change(screen.getByRole('textbox', { name: 'Community name' }), { target: { value: ' Test Guild ' } });
        fireEvent.click(screen.getByRole('button', { name: /^next$/i }));
        expect(mocks.updateMutate).toHaveBeenCalledWith({ communityName: 'Test Guild' }, expect.anything());
        expect(onNext).not.toHaveBeenCalled();
        mocks.updateMutate.mock.calls[0][1].onSuccess();
        expect(onNext).toHaveBeenCalledOnce();
    });
});
