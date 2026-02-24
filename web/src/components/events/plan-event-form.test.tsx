import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ─── Navigation mock ──────────────────────────────────────────────────────────

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
    const actual = await vi.importActual('react-router-dom');
    return {
        ...actual,
        useNavigate: () => mockNavigate,
    };
});

// ─── Mutation / query mock setup ─────────────────────────────────────────────

const mockMutate = vi.fn();
const mockTimeSuggestions = {
    source: 'fallback',
    interestedPlayerCount: 0,
    suggestions: [
        { date: '2026-03-10T18:00:00.000Z', label: 'Monday Mar 10, 6:00 PM', availableCount: 0 },
        { date: '2026-03-11T18:00:00.000Z', label: 'Tuesday Mar 11, 6:00 PM', availableCount: 0 },
    ],
};

vi.mock('../../hooks/use-event-plans', () => ({
    useCreateEventPlan: vi.fn(() => ({
        mutate: mockMutate,
        isPending: false,
    })),
    useTimeSuggestions: vi.fn(() => ({
        data: mockTimeSuggestions,
        isLoading: false,
    })),
}));

// ─── Game registry mock ───────────────────────────────────────────────────────

vi.mock('../../hooks/use-game-registry', () => ({
    useGameRegistry: vi.fn(() => ({ games: [] })),
    useEventTypes: vi.fn(() => ({ data: undefined })),
}));

// ─── Plugin mocks ────────────────────────────────────────────────────────────

vi.mock('../../plugins', () => ({
    PluginSlot: vi.fn(() => null),
}));

vi.mock('../../plugins/wow/utils', () => ({
    getWowVariant: vi.fn(() => null),
    getContentType: vi.fn(() => null),
}));

// ─── API client mock ──────────────────────────────────────────────────────────

vi.mock('../../lib/api-client', () => ({
    getTimeSuggestions: vi.fn(),
    createEventPlan: vi.fn(),
}));

// ─── Toast mock ───────────────────────────────────────────────────────────────

vi.mock('../../lib/toast', () => ({
    toast: {
        success: vi.fn(),
        error: vi.fn(),
    },
}));

// ─── Child component mocks ────────────────────────────────────────────────────

vi.mock('./game-search-input', () => ({
    GameSearchInput: vi.fn(() => <div data-testid="game-search-input" />),
}));

// ─── Import under test AFTER mocks ────────────────────────────────────────────

import { PlanEventForm } from './plan-event-form';
import { useCreateEventPlan, useTimeSuggestions } from '../../hooks/use-event-plans';

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
                <PlanEventForm />
            </MemoryRouter>
        </QueryClientProvider>,
    );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('PlanEventForm — rendering', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (useCreateEventPlan as ReturnType<typeof vi.fn>).mockReturnValue({
            mutate: mockMutate,
            isPending: false,
        });
        (useTimeSuggestions as ReturnType<typeof vi.fn>).mockReturnValue({
            data: mockTimeSuggestions,
            isLoading: false,
        });
    });

    it('should render the form', () => {
        const { container } = renderForm();
        expect(container.querySelector('form')).toBeTruthy();
    });

    it('should render title input', () => {
        renderForm();
        expect(screen.getByPlaceholderText('Weekly Raid Night')).toBeTruthy();
    });

    it('should render the "Start Poll" submit button', () => {
        renderForm();
        expect(screen.getByRole('button', { name: 'Start Poll' })).toBeTruthy();
    });

    it('should render both poll mode buttons', () => {
        renderForm();
        expect(screen.getByRole('button', { name: 'Standard' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'All or Nothing' })).toBeTruthy();
    });

    it('should show suggestions from useTimeSuggestions', () => {
        renderForm();
        expect(screen.getByText('Monday Mar 10, 6:00 PM')).toBeTruthy();
        expect(screen.getByText('Tuesday Mar 11, 6:00 PM')).toBeTruthy();
    });

    it('should show "Loading suggestions..." when isLoading is true', () => {
        (useTimeSuggestions as ReturnType<typeof vi.fn>).mockReturnValue({
            data: undefined,
            isLoading: true,
        });

        renderForm();
        expect(screen.getByText('Loading suggestions...')).toBeTruthy();
    });

    it('should show "No suggestions available" when no suggestions', () => {
        (useTimeSuggestions as ReturnType<typeof vi.fn>).mockReturnValue({
            data: { source: 'fallback', interestedPlayerCount: 0, suggestions: [] },
            isLoading: false,
        });

        renderForm();
        expect(screen.getByText(/No suggestions available/)).toBeTruthy();
    });
});

describe('PlanEventForm — poll mode selector', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (useCreateEventPlan as ReturnType<typeof vi.fn>).mockReturnValue({
            mutate: mockMutate,
            isPending: false,
        });
        (useTimeSuggestions as ReturnType<typeof vi.fn>).mockReturnValue({
            data: mockTimeSuggestions,
            isLoading: false,
        });
    });

    it('should show standard mode description text when standard is selected', () => {
        renderForm();
        expect(
            screen.getByText(/None of these work.*only wins if it gets the most votes/i),
        ).toBeTruthy();
    });

    it('should show all_or_nothing description when that mode is selected', () => {
        renderForm();
        const aonBtn = screen.getByRole('button', { name: 'All or Nothing' });
        fireEvent.click(aonBtn);

        expect(
            screen.getByText(/If ANY voter picks.*None of these work/i),
        ).toBeTruthy();
    });
});

describe('PlanEventForm — time slot selection', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (useCreateEventPlan as ReturnType<typeof vi.fn>).mockReturnValue({
            mutate: mockMutate,
            isPending: false,
        });
        (useTimeSuggestions as ReturnType<typeof vi.fn>).mockReturnValue({
            data: mockTimeSuggestions,
            isLoading: false,
        });
    });

    it('should add a time slot when a suggestion is clicked', () => {
        renderForm();
        const firstSuggestion = screen.getByText('Monday Mar 10, 6:00 PM');
        fireEvent.click(firstSuggestion.closest('button')!);

        // Selected slots section should appear
        expect(screen.getByText('Selected (1/9)')).toBeTruthy();
    });

    it('should not allow adding the same slot twice', () => {
        renderForm();
        const btn = screen.getByText('Monday Mar 10, 6:00 PM').closest('button')!;

        fireEvent.click(btn);
        fireEvent.click(btn);

        // Still only 1 selected
        expect(screen.getByText('Selected (1/9)')).toBeTruthy();
    });

    it('should remove a time slot when remove button is clicked', () => {
        renderForm();
        const suggestionBtn = screen.getByText('Monday Mar 10, 6:00 PM').closest('button')!;
        fireEvent.click(suggestionBtn);

        // Should show the slot in selected list
        expect(screen.getByText('Selected (1/9)')).toBeTruthy();

        // Click the remove button
        const removeBtn = screen.getByLabelText('Remove time slot');
        fireEvent.click(removeBtn);

        // Should be gone
        expect(screen.queryByText('Selected (1/9)')).toBeNull();
    });

    it('should show "Selected (N/9)" count for selected slots', () => {
        renderForm();

        // Select both suggestions
        const monBtn = screen.getByText('Monday Mar 10, 6:00 PM').closest('button')!;
        const tueBtn = screen.getByText('Tuesday Mar 11, 6:00 PM').closest('button')!;

        fireEvent.click(monBtn);
        fireEvent.click(tueBtn);

        expect(screen.getByText('Selected (2/9)')).toBeTruthy();
    });
});

describe('PlanEventForm — validation', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (useCreateEventPlan as ReturnType<typeof vi.fn>).mockReturnValue({
            mutate: mockMutate,
            isPending: false,
        });
        (useTimeSuggestions as ReturnType<typeof vi.fn>).mockReturnValue({
            data: mockTimeSuggestions,
            isLoading: false,
        });
    });

    it('should show validation error when title is empty on submit', () => {
        renderForm();
        const submitBtn = screen.getByRole('button', { name: 'Start Poll' });
        fireEvent.click(submitBtn);

        expect(screen.getByText('Title is required')).toBeTruthy();
    });

    it('should show validation error when fewer than 2 time slots selected', () => {
        renderForm();

        // Fill in title
        fireEvent.change(screen.getByPlaceholderText('Weekly Raid Night'), {
            target: { value: 'My Raid' },
        });

        // Select only 1 slot
        const monBtn = screen.getByText('Monday Mar 10, 6:00 PM').closest('button')!;
        fireEvent.click(monBtn);

        const submitBtn = screen.getByRole('button', { name: 'Start Poll' });
        fireEvent.click(submitBtn);

        expect(screen.getByText('Select at least 2 time options')).toBeTruthy();
    });

    it('should not call mutate when validation fails', () => {
        renderForm();

        const submitBtn = screen.getByRole('button', { name: 'Start Poll' });
        fireEvent.click(submitBtn);

        expect(mockMutate).not.toHaveBeenCalled();
    });

    it('should call mutate when form is valid', () => {
        renderForm();

        // Fill in title
        fireEvent.change(screen.getByPlaceholderText('Weekly Raid Night'), {
            target: { value: 'My Raid' },
        });

        // Select 2 slots
        const monBtn = screen.getByText('Monday Mar 10, 6:00 PM').closest('button')!;
        const tueBtn = screen.getByText('Tuesday Mar 11, 6:00 PM').closest('button')!;
        fireEvent.click(monBtn);
        fireEvent.click(tueBtn);

        const submitBtn = screen.getByRole('button', { name: 'Start Poll' });
        fireEvent.click(submitBtn);

        expect(mockMutate).toHaveBeenCalledWith(
            expect.objectContaining({
                title: 'My Raid',
                pollOptions: expect.arrayContaining([
                    expect.objectContaining({ date: '2026-03-10T18:00:00.000Z' }),
                    expect.objectContaining({ date: '2026-03-11T18:00:00.000Z' }),
                ]),
            }),
            expect.any(Object),
        );
    });
});

describe('PlanEventForm — submit behavior', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (useCreateEventPlan as ReturnType<typeof vi.fn>).mockReturnValue({
            mutate: mockMutate,
            isPending: false,
        });
        (useTimeSuggestions as ReturnType<typeof vi.fn>).mockReturnValue({
            data: mockTimeSuggestions,
            isLoading: false,
        });
    });

    it('should show "Posting Poll..." when isPending is true', () => {
        (useCreateEventPlan as ReturnType<typeof vi.fn>).mockReturnValue({
            mutate: mockMutate,
            isPending: true,
        });

        renderForm();

        expect(screen.getByRole('button', { name: 'Posting Poll...' })).toBeTruthy();
    });

    it('should disable submit button when isPending', () => {
        (useCreateEventPlan as ReturnType<typeof vi.fn>).mockReturnValue({
            mutate: mockMutate,
            isPending: true,
        });

        renderForm();

        const submitBtn = screen.getByRole('button', { name: 'Posting Poll...' });
        expect(submitBtn).toBeDisabled();
    });

    it('should include pollMode in submitted DTO', () => {
        renderForm();

        // Fill required fields
        fireEvent.change(screen.getByPlaceholderText('Weekly Raid Night'), {
            target: { value: 'My Raid' },
        });

        // Switch to All or Nothing
        fireEvent.click(screen.getByRole('button', { name: 'All or Nothing' }));

        // Select 2 slots
        fireEvent.click(screen.getByText('Monday Mar 10, 6:00 PM').closest('button')!);
        fireEvent.click(screen.getByText('Tuesday Mar 11, 6:00 PM').closest('button')!);

        fireEvent.click(screen.getByRole('button', { name: 'Start Poll' }));

        expect(mockMutate).toHaveBeenCalledWith(
            expect.objectContaining({ pollMode: 'all_or_nothing' }),
            expect.any(Object),
        );
    });

    it('should navigate to /events on successful creation via onSuccess callback', () => {
        let capturedCallbacks: { onSuccess?: () => void } = {};

        (useCreateEventPlan as ReturnType<typeof vi.fn>).mockReturnValue({
            mutate: vi.fn((_dto: unknown, callbacks: { onSuccess?: () => void }) => {
                capturedCallbacks = callbacks;
            }),
            isPending: false,
        });

        renderForm();

        // Fill required fields
        fireEvent.change(screen.getByPlaceholderText('Weekly Raid Night'), {
            target: { value: 'My Raid' },
        });
        fireEvent.click(screen.getByText('Monday Mar 10, 6:00 PM').closest('button')!);
        fireEvent.click(screen.getByText('Tuesday Mar 11, 6:00 PM').closest('button')!);
        fireEvent.click(screen.getByRole('button', { name: 'Start Poll' }));

        // Simulate success callback
        capturedCallbacks.onSuccess?.();

        expect(mockNavigate).toHaveBeenCalledWith('/events');
    });

    it('should navigate to /events when Cancel button clicked', () => {
        renderForm();

        const cancelBtn = screen.getByRole('button', { name: 'Cancel' });
        fireEvent.click(cancelBtn);

        expect(mockNavigate).toHaveBeenCalledWith('/events');
    });
});

describe('PlanEventForm — custom time entry', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (useCreateEventPlan as ReturnType<typeof vi.fn>).mockReturnValue({
            mutate: mockMutate,
            isPending: false,
        });
        (useTimeSuggestions as ReturnType<typeof vi.fn>).mockReturnValue({
            data: { source: 'fallback', interestedPlayerCount: 0, suggestions: [] },
            isLoading: false,
        });
    });

    it('should render the custom date and time inputs', () => {
        renderForm();
        expect(document.querySelector('input[type="date"]')).toBeTruthy();
        expect(document.querySelector('input[type="time"]')).toBeTruthy();
    });

    it('should disable the Add button when date or time is missing', () => {
        renderForm();
        const addBtn = screen.getByRole('button', { name: 'Add' });
        expect(addBtn).toBeDisabled();
    });

    it('should enable the Add button when both date and time are filled', () => {
        renderForm();

        const dateInput = document.querySelector('input[type="date"]')!;
        const timeInput = document.querySelector('input[type="time"]')!;

        fireEvent.change(dateInput, { target: { value: '2026-03-15' } });
        fireEvent.change(timeInput, { target: { value: '19:00' } });

        const addBtn = screen.getByRole('button', { name: 'Add' });
        expect(addBtn).not.toBeDisabled();
    });
});
