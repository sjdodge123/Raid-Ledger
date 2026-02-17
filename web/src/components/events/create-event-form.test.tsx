import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CreateEventForm } from './create-event-form';

// ─── Router/Navigation mock ───────────────────────────────────────────────────
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
    const actual = await vi.importActual('react-router-dom');
    return {
        ...actual,
        useNavigate: () => mockNavigate,
    };
});

// ─── TanStack Query mutation mock ─────────────────────────────────────────────
vi.mock('@tanstack/react-query', async () => {
    const actual = await vi.importActual('@tanstack/react-query');
    return {
        ...actual,
        useMutation: vi.fn(() => ({
            mutate: vi.fn(),
            isPending: false,
        })),
    };
});

// ─── API client mock ──────────────────────────────────────────────────────────
vi.mock('../../lib/api-client', () => ({
    createEvent: vi.fn(),
    updateEvent: vi.fn(),
}));

// ─── Toast mock ───────────────────────────────────────────────────────────────
vi.mock('../../lib/toast', () => ({
    toast: {
        success: vi.fn(),
        error: vi.fn(),
    },
}));

// ─── Timezone store mock ──────────────────────────────────────────────────────
vi.mock('../../stores/timezone-store', () => ({
    useTimezoneStore: vi.fn((selector: (s: { resolved: string }) => unknown) =>
        selector({ resolved: 'America/New_York' }),
    ),
}));

vi.mock('../../lib/timezone-utils', () => ({
    getTimezoneAbbr: vi.fn(() => 'EST'),
}));

// ─── Hook mocks ───────────────────────────────────────────────────────────────
vi.mock('../../hooks/use-event-templates', () => ({
    useEventTemplates: vi.fn(() => ({ data: null })),
    useCreateTemplate: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
    useDeleteTemplate: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
}));

vi.mock('../../hooks/use-game-registry', () => ({
    useGameRegistry: vi.fn(() => ({ games: [] })),
    useEventTypes: vi.fn(() => ({ data: null })),
}));

vi.mock('../../hooks/use-want-to-play', () => ({
    useWantToPlay: vi.fn(() => ({ count: 0, isLoading: false })),
}));

// ─── Plugin/WoW mocks ─────────────────────────────────────────────────────────
vi.mock('../../plugins', () => ({
    PluginSlot: vi.fn(() => null),
}));

vi.mock('../../plugins/wow/utils', () => ({
    getWowVariant: vi.fn(() => null),
    getContentType: vi.fn(() => null),
}));

// ─── Child component mocks ────────────────────────────────────────────────────
vi.mock('./game-search-input', () => ({
    GameSearchInput: vi.fn(() => <div data-testid="game-search-input" />),
}));

vi.mock('../features/heatmap', () => ({
    TeamAvailabilityPicker: vi.fn(() => <div data-testid="team-availability-picker" />),
}));

// ─── Test helpers ─────────────────────────────────────────────────────────────
function createQueryClient() {
    return new QueryClient({
        defaultOptions: { queries: { retry: false } },
    });
}

function renderForm() {
    return render(
        <QueryClientProvider client={createQueryClient()}>
            <MemoryRouter>
                <CreateEventForm />
            </MemoryRouter>
        </QueryClientProvider>,
    );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('CreateEventForm — form section spacing', () => {
    it('applies space-y-4 sm:space-y-8 to the root form (mobile-first spacing)', () => {
        const { container } = renderForm();
        const form = container.querySelector('form');
        expect(form).not.toBeNull();
        expect(form!.className).toContain('space-y-4');
        expect(form!.className).toContain('sm:space-y-8');
    });
});

describe('CreateEventForm — SlotStepper touch targets', () => {
    beforeEach(() => {
        renderForm();
    });

    it('stepper decrement buttons have w-11 h-11 class for 44px mobile touch target', () => {
        // Find all decrement (-) buttons in the slot stepper area
        const decrementButtons = screen.getAllByRole('button', { name: '-' });
        expect(decrementButtons.length).toBeGreaterThan(0);
        decrementButtons.forEach((btn) => {
            expect(btn.className).toContain('w-11');
            expect(btn.className).toContain('h-11');
        });
    });

    it('stepper increment buttons have w-11 h-11 class for 44px mobile touch target', () => {
        const incrementButtons = screen.getAllByRole('button', { name: '+' });
        expect(incrementButtons.length).toBeGreaterThan(0);
        incrementButtons.forEach((btn) => {
            expect(btn.className).toContain('w-11');
            expect(btn.className).toContain('h-11');
        });
    });

    it('stepper buttons have sm:w-8 sm:h-8 for 32px desktop size override', () => {
        const decrementButtons = screen.getAllByRole('button', { name: '-' });
        decrementButtons.forEach((btn) => {
            expect(btn.className).toContain('sm:w-8');
            expect(btn.className).toContain('sm:h-8');
        });
    });
});

describe('CreateEventForm — SlotStepper input width', () => {
    it('stepper number inputs have w-14 class for touch-friendly width on mobile', () => {
        const { container } = renderForm();
        // SlotStepper inputs are number inputs inside the slot stepper container
        const stepperContainer = container.querySelector('.divide-y');
        expect(stepperContainer).not.toBeNull();
        const numberInputs = stepperContainer!.querySelectorAll('input[type="number"]');
        expect(numberInputs.length).toBeGreaterThan(0);
        numberInputs.forEach((input) => {
            expect(input.className).toContain('w-14');
        });
    });

    it('stepper number inputs have sm:w-12 for desktop width override', () => {
        const { container } = renderForm();
        const stepperContainer = container.querySelector('.divide-y');
        expect(stepperContainer).not.toBeNull();
        const numberInputs = stepperContainer!.querySelectorAll('input[type="number"]');
        numberInputs.forEach((input) => {
            expect(input.className).toContain('sm:w-12');
        });
    });

    it('stepper inputs have h-11 height class on mobile', () => {
        const { container } = renderForm();
        const stepperContainer = container.querySelector('.divide-y');
        expect(stepperContainer).not.toBeNull();
        const numberInputs = stepperContainer!.querySelectorAll('input[type="number"]');
        numberInputs.forEach((input) => {
            expect(input.className).toContain('h-11');
        });
    });

    it('stepper inputs have sm:h-8 height class on desktop', () => {
        const { container } = renderForm();
        const stepperContainer = container.querySelector('.divide-y');
        expect(stepperContainer).not.toBeNull();
        const numberInputs = stepperContainer!.querySelectorAll('input[type="number"]');
        numberInputs.forEach((input) => {
            expect(input.className).toContain('sm:h-8');
        });
    });
});

describe('CreateEventForm — custom duration inputs stacking', () => {
    it('custom duration wrapper uses flex-col on mobile and sm:flex-row on desktop', () => {
        const { container } = renderForm();

        // Click "Custom" duration button to reveal the custom inputs
        const customBtn = screen.getByRole('button', { name: 'Custom' });
        fireEvent.click(customBtn);

        // The custom duration row should now be visible
        const durationWrapper = container.querySelector('.flex.flex-col.sm\\:flex-row');
        expect(durationWrapper).not.toBeNull();
    });

    it('custom duration wrapper has gap-2 and sm:gap-3', () => {
        const { container } = renderForm();

        const customBtn = screen.getByRole('button', { name: 'Custom' });
        fireEvent.click(customBtn);

        const durationWrapper = container.querySelector('.flex.flex-col.sm\\:flex-row');
        expect(durationWrapper).not.toBeNull();
        expect(durationWrapper!.className).toContain('gap-2');
        expect(durationWrapper!.className).toContain('sm:gap-3');
    });

    it('custom duration hr input has w-full class on mobile', () => {
        const { container } = renderForm();

        const customBtn = screen.getByRole('button', { name: 'Custom' });
        fireEvent.click(customBtn);

        const durationWrapper = container.querySelector('.flex.flex-col.sm\\:flex-row');
        expect(durationWrapper).not.toBeNull();
        const inputs = durationWrapper!.querySelectorAll('input[type="number"]');
        expect(inputs.length).toBe(2);
        // Both hr and min inputs should have w-full for mobile stacking
        inputs.forEach((input) => {
            expect(input.className).toContain('w-full');
        });
    });

    it('custom duration inputs show hr and min labels', () => {
        renderForm();
        const customBtn = screen.getByRole('button', { name: 'Custom' });
        fireEvent.click(customBtn);

        expect(screen.getByText('hr')).toBeInTheDocument();
        expect(screen.getByText('min')).toBeInTheDocument();
    });
});

describe('CreateEventForm — SlotStepper row minimum height', () => {
    it('stepper rows have min-h-[44px] on mobile', () => {
        const { container } = renderForm();
        const stepperRows = container.querySelectorAll('.min-h-\\[44px\\]');
        expect(stepperRows.length).toBeGreaterThan(0);
    });

    it('stepper rows have sm:min-h-0 to clear min-height on desktop', () => {
        const { container } = renderForm();
        const stepperRows = container.querySelectorAll('.sm\\:min-h-0');
        expect(stepperRows.length).toBeGreaterThan(0);
    });
});

describe('CreateEventForm — SlotStepper behavior', () => {
    it('increments slot value when + button is clicked', () => {
        const { container } = renderForm();
        const stepperContainer = container.querySelector('.divide-y');
        expect(stepperContainer).not.toBeNull();
        const numberInputs = stepperContainer!.querySelectorAll('input[type="number"]');
        const firstInput = numberInputs[0] as HTMLInputElement;
        const initialValue = parseInt(firstInput.value);

        const incrementButtons = screen.getAllByRole('button', { name: '+' });
        fireEvent.click(incrementButtons[0]);

        expect(parseInt(firstInput.value)).toBe(initialValue + 1);
    });

    it('decrements slot value when - button is clicked', () => {
        const { container } = renderForm();
        const stepperContainer = container.querySelector('.divide-y');
        expect(stepperContainer).not.toBeNull();
        const numberInputs = stepperContainer!.querySelectorAll('input[type="number"]');
        const firstInput = numberInputs[0] as HTMLInputElement;
        const initialValue = parseInt(firstInput.value);

        const decrementButtons = screen.getAllByRole('button', { name: '-' });
        fireEvent.click(decrementButtons[0]);

        // Value should not go below 0 (min)
        expect(parseInt(firstInput.value)).toBe(Math.max(0, initialValue - 1));
    });

    it('decrement button is disabled when value is at minimum (0)', () => {
        renderForm();
        // Find the Bench row's decrement button
        const benchLabel = screen.getByText('Bench');
        const benchRow = benchLabel.closest('.flex.items-center.justify-between');
        expect(benchRow).not.toBeNull();
        const buttons = benchRow!.querySelectorAll('button[type="button"]');
        // First button in the row is decrement (-), last is increment (+)
        const benchDecrement = buttons[0] as HTMLButtonElement;
        const benchInput = benchRow!.querySelector('input[type="number"]') as HTMLInputElement;
        expect(benchDecrement).not.toBeUndefined();

        // Click decrement until we reach 0
        const initialVal = parseInt(benchInput.value);
        for (let i = 0; i < initialVal; i++) {
            fireEvent.click(benchDecrement);
        }

        expect(parseInt(benchInput.value)).toBe(0);
        expect(benchDecrement).toBeDisabled();
    });
});

describe('CreateEventForm — desktop layout unchanged', () => {
    it('renders all slot type buttons', () => {
        renderForm();
        expect(screen.getByRole('button', { name: 'MMO Roles' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Generic Slots' })).toBeInTheDocument();
    });

    it('renders all duration preset buttons', () => {
        renderForm();
        expect(screen.getByRole('button', { name: '1h' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: '1.5h' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: '2h' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: '3h' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: '4h' })).toBeInTheDocument();
    });

    it('renders form section labels', () => {
        renderForm();
        expect(screen.getByText('Game & Content')).toBeInTheDocument();
        expect(screen.getByText('Details')).toBeInTheDocument();
        expect(screen.getByText('When')).toBeInTheDocument();
        expect(screen.getByText('Roster')).toBeInTheDocument();
    });

    it('renders Create Event submit button', () => {
        renderForm();
        expect(screen.getByRole('button', { name: 'Create Event' })).toBeInTheDocument();
    });
});

describe('CreateEventForm — MMO vs generic slot toggle', () => {
    it('shows MMO role steppers (Tank, Healer, DPS, Flex) when MMO Roles selected', () => {
        renderForm();
        fireEvent.click(screen.getByRole('button', { name: 'MMO Roles' }));

        expect(screen.getByText('Tank')).toBeInTheDocument();
        expect(screen.getByText('Healer')).toBeInTheDocument();
        expect(screen.getByText('DPS')).toBeInTheDocument();
        expect(screen.getByText('Flex')).toBeInTheDocument();
    });

    it('shows Players stepper when Generic Slots selected', () => {
        renderForm();
        fireEvent.click(screen.getByRole('button', { name: 'Generic Slots' }));

        expect(screen.getByText('Players')).toBeInTheDocument();
    });

    it('always shows Bench stepper regardless of slot type', () => {
        renderForm();
        expect(screen.getByText('Bench')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'MMO Roles' }));
        expect(screen.getByText('Bench')).toBeInTheDocument();
    });
});
