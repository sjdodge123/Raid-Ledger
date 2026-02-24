import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CreateEventForm } from './create-event-form';

// ─── jsdom does not implement scrollIntoView — suppress unhandled errors ─────
window.HTMLElement.prototype.scrollIntoView = vi.fn();

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

describe('CreateEventForm — custom duration inputs stacking', () => {
    it('custom duration inputs show hr and min labels', () => {
        renderForm();
        const customBtn = screen.getByRole('button', { name: 'Custom' });
        fireEvent.click(customBtn);

        expect(screen.getByText('hr')).toBeInTheDocument();
        expect(screen.getByText('min')).toBeInTheDocument();
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

// ─── Recurrence section tests (ROK-422 QA hardening) ─────────────────────────

describe('CreateEventForm — recurrence section visibility', () => {
    it('shows the Repeat select in create mode', () => {
        renderForm();
        expect(screen.getByLabelText(/repeat/i)).toBeInTheDocument();
    });

    it('does not show the recurrence until field when no frequency is selected', () => {
        renderForm();
        expect(screen.queryByLabelText(/repeat until/i)).not.toBeInTheDocument();
    });

    it('shows Repeat Until date input when a frequency is selected', () => {
        renderForm();
        const repeatSelect = screen.getByLabelText(/repeat/i);
        fireEvent.change(repeatSelect, { target: { value: 'weekly' } });

        expect(screen.getByLabelText(/repeat until/i)).toBeInTheDocument();
    });

    it('hides the recurrence section when in edit mode', () => {
        const editEvent = {
            id: 1,
            title: 'Test Event',
            description: null,
            startTime: '2026-03-01T19:00:00.000Z',
            endTime: '2026-03-01T21:00:00.000Z',
            creator: { id: 1, username: 'user', avatar: null, discordId: null, customAvatarUrl: null },
            game: null,
            signupCount: 0,
            slotConfig: null,
            maxAttendees: null,
            autoUnbench: true,
            contentInstances: null,
            recurrenceGroupId: null,
            recurrenceRule: null,
            reminder15min: true,
            reminder1hour: false,
            reminder24hour: false,
            cancelledAt: null,
            cancellationReason: null,
            createdAt: '2026-03-01T00:00:00.000Z',
            updatedAt: '2026-03-01T00:00:00.000Z',
        };
        render(
            <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
                <MemoryRouter>
                    <CreateEventForm event={editEvent as never} />
                </MemoryRouter>
            </QueryClientProvider>,
        );

        // Repeat select should not be in the DOM in edit mode
        expect(screen.queryByLabelText(/repeat/i)).not.toBeInTheDocument();
    });
});

describe('CreateEventForm — recurrence validation', () => {
    it('shows error when frequency is set but until date is missing', async () => {
        const { container } = renderForm();

        // Fill in required fields to reach recurrence validation
        fireEvent.change(container.querySelector('#startDate')!, { target: { value: '2026-03-01' } });
        fireEvent.change(container.querySelector('#startTime')!, { target: { value: '19:00' } });
        // Set a title via the hidden input approach
        const titleInput = container.querySelector('#title') as HTMLInputElement | null;
        if (titleInput) fireEvent.change(titleInput, { target: { value: 'Test Event' } });

        // Select a recurrence frequency without setting until
        const repeatSelect = screen.getByLabelText(/repeat/i);
        fireEvent.change(repeatSelect, { target: { value: 'weekly' } });

        // Submit the form
        fireEvent.submit(container.querySelector('form')!);

        // Error message should appear
        expect(await screen.findByText('End date is required for recurring events')).toBeInTheDocument();
    });

    it('shows error when recurrence until is on or before start date', async () => {
        const { container } = renderForm();

        fireEvent.change(container.querySelector('#startDate')!, { target: { value: '2026-03-15' } });
        fireEvent.change(container.querySelector('#startTime')!, { target: { value: '19:00' } });
        const titleInput = container.querySelector('#title') as HTMLInputElement | null;
        if (titleInput) fireEvent.change(titleInput, { target: { value: 'Test Event' } });

        const repeatSelect = screen.getByLabelText(/repeat/i);
        fireEvent.change(repeatSelect, { target: { value: 'weekly' } });

        // Set until to same day as start (should fail: must be AFTER start)
        const untilInput = screen.getByLabelText(/repeat until/i);
        fireEvent.change(untilInput, { target: { value: '2026-03-15' } });

        fireEvent.submit(container.querySelector('form')!);

        expect(await screen.findByText('End date must be after start date')).toBeInTheDocument();
    });
});

describe('CreateEventForm — recurrence instance count preview', () => {
    it('shows instance count preview when frequency and until are set', async () => {
        const { container } = renderForm();

        fireEvent.change(container.querySelector('#startDate')!, { target: { value: '2026-03-01' } });

        const repeatSelect = screen.getByLabelText(/repeat/i);
        fireEvent.change(repeatSelect, { target: { value: 'weekly' } });

        const untilInput = screen.getByLabelText(/repeat until/i);
        // 4 weeks after start = 4 weekly occurrences (Mar 1, 8, 15, 22)
        fireEvent.change(untilInput, { target: { value: '2026-03-22' } });

        // The preview text should appear with the count
        const preview = await screen.findByText(/creates/i);
        expect(preview).toBeInTheDocument();
        expect(preview.textContent).toMatch(/4/);
    });

    it('shows no instance count preview when until is before start', () => {
        const { container } = renderForm();

        fireEvent.change(container.querySelector('#startDate')!, { target: { value: '2026-03-15' } });

        const repeatSelect = screen.getByLabelText(/repeat/i);
        fireEvent.change(repeatSelect, { target: { value: 'weekly' } });

        const untilInput = screen.getByLabelText(/repeat until/i);
        fireEvent.change(untilInput, { target: { value: '2026-03-10' } }); // before start

        // Count is 0 when until <= start, so preview text should NOT appear
        expect(screen.queryByText(/creates/i)).not.toBeInTheDocument();
    });

    it('caps instance count preview at 52 for a far-future until date', async () => {
        const { container } = renderForm();

        fireEvent.change(container.querySelector('#startDate')!, { target: { value: '2026-01-01' } });

        const repeatSelect = screen.getByLabelText(/repeat/i);
        fireEvent.change(repeatSelect, { target: { value: 'weekly' } });

        const untilInput = screen.getByLabelText(/repeat until/i);
        fireEvent.change(untilInput, { target: { value: '2030-12-31' } }); // far future

        const preview = await screen.findByText(/creates/i);
        expect(preview).toBeInTheDocument();
        // The count shown must be exactly 52 (cap), not more
        expect(preview.textContent).toMatch(/52/);
    });
});
