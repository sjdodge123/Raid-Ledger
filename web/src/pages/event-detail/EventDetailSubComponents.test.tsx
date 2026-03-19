import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { EventDetailTopbar, MoreActionsMenu } from './EventDetailSubComponents';

const defaultProps = {
    fromCalendar: false,
    navState: null,
    hasHistory: false,
    isAuthenticated: true,
    canManageRoster: true,
    isCancelled: false,
    isEnded: false,
    eventId: 1,
    onInvite: vi.fn(),
    onReschedule: vi.fn(),
    onCancel: vi.fn(),
    onDelete: vi.fn(),
    onSeriesAction: vi.fn(),
    recurrenceGroupId: null as string | null,
};

function renderTopbar(overrides: Partial<typeof defaultProps> = {}) {
    return render(
        <MemoryRouter>
            <EventDetailTopbar {...defaultProps} {...overrides} />
        </MemoryRouter>,
    );
}

describe('EventDetailTopbar — delete button', () => {
    beforeEach(() => { vi.clearAllMocks(); });

    it('shows Delete Event button for managers', () => {
        renderTopbar();
        expect(screen.getByRole('button', { name: 'Delete Event' })).toBeInTheDocument();
    });

    it('does not show Delete Event for non-managers', () => {
        renderTopbar({ canManageRoster: false });
        expect(screen.queryByRole('button', { name: 'Delete Event' })).not.toBeInTheDocument();
    });

    it('shows Delete Event even when cancelled (for cleanup)', () => {
        renderTopbar({ isCancelled: true });
        expect(screen.getByRole('button', { name: 'Delete Event' })).toBeInTheDocument();
    });

    it('calls onDelete when Delete Event is clicked for non-series', async () => {
        const onDelete = vi.fn();
        const user = userEvent.setup();
        renderTopbar({ onDelete });
        await user.click(screen.getByRole('button', { name: 'Delete Event' }));
        expect(onDelete).toHaveBeenCalledOnce();
    });
});

describe('EventDetailTopbar — series event behavior', () => {
    beforeEach(() => { vi.clearAllMocks(); });

    it('calls onSeriesAction with "edit" for series events on Edit click', async () => {
        const onSeriesAction = vi.fn();
        const user = userEvent.setup();
        renderTopbar({ recurrenceGroupId: 'abc-123', onSeriesAction });
        await user.click(screen.getByRole('button', { name: 'Edit Event' }));
        expect(onSeriesAction).toHaveBeenCalledWith('edit');
    });

    it('calls onSeriesAction with "cancel" for series events on Cancel click', async () => {
        const onSeriesAction = vi.fn();
        const user = userEvent.setup();
        renderTopbar({ recurrenceGroupId: 'abc-123', onSeriesAction });
        await user.click(screen.getByRole('button', { name: 'Cancel Event' }));
        expect(onSeriesAction).toHaveBeenCalledWith('cancel');
    });

    it('calls onSeriesAction with "delete" for series events on Delete click', async () => {
        const onSeriesAction = vi.fn();
        const user = userEvent.setup();
        renderTopbar({ recurrenceGroupId: 'abc-123', onSeriesAction });
        await user.click(screen.getByRole('button', { name: 'Delete Event' }));
        expect(onSeriesAction).toHaveBeenCalledWith('delete');
    });

    it('navigates directly on Edit for non-series events', async () => {
        const onSeriesAction = vi.fn();
        const user = userEvent.setup();
        renderTopbar({ recurrenceGroupId: null, onSeriesAction });
        await user.click(screen.getByRole('button', { name: 'Edit Event' }));
        expect(onSeriesAction).not.toHaveBeenCalled();
    });

    it('calls onCancel directly for non-series cancel', async () => {
        const onCancel = vi.fn();
        const onSeriesAction = vi.fn();
        const user = userEvent.setup();
        renderTopbar({ recurrenceGroupId: null, onCancel, onSeriesAction });
        await user.click(screen.getByRole('button', { name: 'Cancel Event' }));
        expect(onCancel).toHaveBeenCalledOnce();
        expect(onSeriesAction).not.toHaveBeenCalled();
    });
});

describe('Regression: ROK-761 — back button mobile touch target', () => {
    it('renders a back button with accessible label', () => {
        renderTopbar();
        const backBtn = screen.getByRole('button', { name: 'Go back' });
        expect(backBtn).toBeInTheDocument();
    });

    it('back button is tappable', async () => {
        const user = userEvent.setup();
        renderTopbar();
        const backBtn = screen.getByRole('button', { name: 'Go back' });
        await user.click(backBtn);
        // Should not throw — button is interactive
        expect(backBtn).toBeEnabled();
    });

    it('shows "Back to Calendar" text when navigated from calendar', () => {
        renderTopbar({ fromCalendar: true, navState: { calendarDate: '2026-03-10' } });
        const backBtn = screen.getByRole('button', { name: 'Go back' });
        expect(backBtn).toHaveTextContent('\u2190 Back to Calendar');
    });

    it('shows "Back" text when not from calendar', () => {
        renderTopbar({ fromCalendar: false });
        const backBtn = screen.getByRole('button', { name: 'Go back' });
        expect(backBtn).toHaveTextContent('\u2190 Back');
    });
});

describe('ROK-886: MoreActionsMenu — overflow menu', () => {
    const menuProps = {
        onReschedule: vi.fn(),
        onCancel: vi.fn(),
        onDelete: vi.fn(),
    };

    beforeEach(() => { vi.clearAllMocks(); });

    it('renders a button with aria-label "More actions"', () => {
        render(<MoreActionsMenu {...menuProps} />);
        expect(screen.getByRole('button', { name: 'More actions' })).toBeInTheDocument();
    });

    it('dropdown is hidden by default', () => {
        render(<MoreActionsMenu {...menuProps} />);
        expect(screen.queryByRole('button', { name: 'Reschedule' })).not.toBeInTheDocument();
    });

    it('opens dropdown with all items when clicked', async () => {
        const user = userEvent.setup();
        render(<MoreActionsMenu {...menuProps} />);
        await user.click(screen.getByRole('button', { name: 'More actions' }));
        expect(screen.getByRole('button', { name: 'Reschedule' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Cancel Event' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Delete Event' })).toBeInTheDocument();
    });

    it('calls onReschedule and closes menu when Reschedule is clicked', async () => {
        const user = userEvent.setup();
        render(<MoreActionsMenu {...menuProps} />);
        await user.click(screen.getByRole('button', { name: 'More actions' }));
        await user.click(screen.getByRole('button', { name: 'Reschedule' }));
        expect(menuProps.onReschedule).toHaveBeenCalledOnce();
        expect(screen.queryByRole('button', { name: 'Reschedule' })).not.toBeInTheDocument();
    });

    it('calls onCancel and closes menu when Cancel Event is clicked', async () => {
        const user = userEvent.setup();
        render(<MoreActionsMenu {...menuProps} />);
        await user.click(screen.getByRole('button', { name: 'More actions' }));
        await user.click(screen.getByRole('button', { name: 'Cancel Event' }));
        expect(menuProps.onCancel).toHaveBeenCalledOnce();
        expect(screen.queryByRole('button', { name: 'Cancel Event' })).not.toBeInTheDocument();
    });

    it('calls onDelete and closes menu when Delete Event is clicked', async () => {
        const user = userEvent.setup();
        render(<MoreActionsMenu {...menuProps} />);
        await user.click(screen.getByRole('button', { name: 'More actions' }));
        await user.click(screen.getByRole('button', { name: 'Delete Event' }));
        expect(menuProps.onDelete).toHaveBeenCalledOnce();
        expect(screen.queryByRole('button', { name: 'Delete Event' })).not.toBeInTheDocument();
    });
});

describe('ROK-886: TopbarManagerButtons — mobile overflow menu present', () => {
    beforeEach(() => { vi.clearAllMocks(); });

    it('renders a "More actions" button for mobile overflow', () => {
        renderTopbar();
        expect(screen.getByRole('button', { name: 'More actions' })).toBeInTheDocument();
    });

    it('mobile layout shows Edit button (shortened label)', () => {
        renderTopbar();
        expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    });
});
