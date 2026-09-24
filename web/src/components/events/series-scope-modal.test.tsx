import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SeriesScopeModal } from './series-scope-modal';

describe('SeriesScopeModal', () => {
    beforeEach(() => { document.body.style.overflow = ''; });
    afterEach(() => { document.body.style.overflow = ''; });

    it('renders nothing when isOpen is false', () => {
        render(
            <SeriesScopeModal isOpen={false} onClose={vi.fn()} onConfirm={vi.fn()} action="edit" />,
        );
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('renders dialog when isOpen is true', () => {
        render(
            <SeriesScopeModal isOpen={true} onClose={vi.fn()} onConfirm={vi.fn()} action="edit" />,
        );
        expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('renders all three scope options as radios in an "Apply to" group', () => {
        render(
            <SeriesScopeModal isOpen={true} onClose={vi.fn()} onConfirm={vi.fn()} action="edit" />,
        );
        const group = screen.getByRole('radiogroup', { name: 'Apply to' });
        const radios = within(group).getAllByRole('radio');
        expect(radios).toHaveLength(3);
        expect(within(group).getByRole('radio', { name: 'This event only' })).toBeChecked();
        expect(within(group).getByRole('radio', { name: 'This and following events' })).not.toBeChecked();
        expect(within(group).getByRole('radio', { name: 'All events in series' })).not.toBeChecked();
    });

    it('shows correct title for edit action', () => {
        render(
            <SeriesScopeModal isOpen={true} onClose={vi.fn()} onConfirm={vi.fn()} action="edit" />,
        );
        expect(screen.getByText('Edit Series Event')).toBeInTheDocument();
    });

    it('shows correct title for delete action', () => {
        render(
            <SeriesScopeModal isOpen={true} onClose={vi.fn()} onConfirm={vi.fn()} action="delete" />,
        );
        expect(screen.getByText('Delete Series Event')).toBeInTheDocument();
    });

    it('shows correct title for cancel action', () => {
        render(
            <SeriesScopeModal isOpen={true} onClose={vi.fn()} onConfirm={vi.fn()} action="cancel" />,
        );
        expect(screen.getByText('Cancel Series Event')).toBeInTheDocument();
    });
});

describe('SeriesScopeModal — layout', () => {
    beforeEach(() => { document.body.style.overflow = ''; });
    afterEach(() => { document.body.style.overflow = ''; });

    it('describes each scope option', () => {
        render(
            <SeriesScopeModal isOpen={true} onClose={vi.fn()} onConfirm={vi.fn()} action="edit" />,
        );
        expect(screen.getByRole('radio', { name: 'This event only' }))
            .toHaveAccessibleDescription('Only the selected event will be affected.');
        expect(screen.getByRole('radio', { name: 'This and following events' }))
            .toHaveAccessibleDescription('This event and all future events in the series.');
        expect(screen.getByRole('radio', { name: 'All events in series' }))
            .toHaveAccessibleDescription('Every event in the recurring series.');
    });

    it('sits the actions in the pinned modal footer', () => {
        render(
            <SeriesScopeModal isOpen={true} onClose={vi.fn()} onConfirm={vi.fn()} action="edit" />,
        );
        const footer = screen.getByTestId('modal-footer');
        expect(within(footer).getByRole('button', { name: 'Back' })).toBeInTheDocument();
        expect(within(footer).getByRole('button', { name: 'Continue' })).toBeInTheDocument();
    });
});

describe('SeriesScopeModal — button labels', () => {
    beforeEach(() => { document.body.style.overflow = ''; });
    afterEach(() => { document.body.style.overflow = ''; });

    it('shows Continue button for edit action', () => {
        render(
            <SeriesScopeModal isOpen={true} onClose={vi.fn()} onConfirm={vi.fn()} action="edit" />,
        );
        expect(screen.getByRole('button', { name: 'Continue' })).toBeInTheDocument();
    });

    it('shows Delete button for delete action', () => {
        render(
            <SeriesScopeModal isOpen={true} onClose={vi.fn()} onConfirm={vi.fn()} action="delete" />,
        );
        expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
    });

    it('shows Cancel Events button for cancel action', () => {
        render(
            <SeriesScopeModal isOpen={true} onClose={vi.fn()} onConfirm={vi.fn()} action="cancel" />,
        );
        expect(screen.getByRole('button', { name: 'Cancel Events' })).toBeInTheDocument();
    });

    it('shows Processing... when isPending is true and swallows the click', async () => {
        const onConfirm = vi.fn();
        const user = userEvent.setup();
        render(
            <SeriesScopeModal isOpen={true} onClose={vi.fn()} onConfirm={onConfirm} action="edit" isPending />,
        );
        const button = screen.getByRole('button', { name: 'Processing...' });
        expect(button).toHaveAttribute('aria-disabled', 'true');
        expect(button).toHaveAttribute('aria-busy', 'true');
        await user.click(button);
        expect(onConfirm).not.toHaveBeenCalled();
    });

    it('paints Continue as the primary action for edit', () => {
        render(
            <SeriesScopeModal isOpen={true} onClose={vi.fn()} onConfirm={vi.fn()} action="edit" />,
        );
        const button = screen.getByRole('button', { name: 'Continue' });
        expect(button).toHaveClass('bg-emerald-600');
        expect(button).not.toHaveClass('bg-red-600');
    });

    it.each([
        ['delete', 'Delete'],
        ['cancel', 'Cancel Events'],
    ] as const)('paints the %s confirm as destructive', (action, name) => {
        render(
            <SeriesScopeModal isOpen={true} onClose={vi.fn()} onConfirm={vi.fn()} action={action} />,
        );
        const button = screen.getByRole('button', { name });
        expect(button).toHaveClass('bg-red-600');
        expect(button).not.toHaveClass('bg-emerald-600');
    });

    it('paints Back as the secondary action', () => {
        render(
            <SeriesScopeModal isOpen={true} onClose={vi.fn()} onConfirm={vi.fn()} action="delete" />,
        );
        expect(screen.getByRole('button', { name: 'Back' })).toHaveClass('bg-panel', 'border-edge');
    });
});

describe('SeriesScopeModal — interactions', () => {
    beforeEach(() => { document.body.style.overflow = ''; });
    afterEach(() => { document.body.style.overflow = ''; });

    it('defaults to "this" scope and confirms with it', async () => {
        const onConfirm = vi.fn();
        const user = userEvent.setup();
        render(
            <SeriesScopeModal isOpen={true} onClose={vi.fn()} onConfirm={onConfirm} action="edit" />,
        );
        expect(screen.getByRole('radio', { name: 'This event only' })).toBeChecked();
        await user.click(screen.getByRole('button', { name: 'Continue' }));
        expect(onConfirm).toHaveBeenCalledWith('this');
    });

    it('moves the choice back to "this" after picking another scope', async () => {
        const onConfirm = vi.fn();
        const user = userEvent.setup();
        render(
            <SeriesScopeModal isOpen={true} onClose={vi.fn()} onConfirm={onConfirm} action="edit" />,
        );
        await user.click(screen.getByRole('radio', { name: 'All events in series' }));
        expect(screen.getByRole('radio', { name: 'All events in series' })).toBeChecked();
        await user.click(screen.getByRole('radio', { name: 'This event only' }));
        expect(screen.getByRole('radio', { name: 'All events in series' })).not.toBeChecked();
        await user.click(screen.getByRole('button', { name: 'Continue' }));
        expect(onConfirm).toHaveBeenCalledWith('this');
    });

    it('selects "all" scope and confirms with it', async () => {
        const onConfirm = vi.fn();
        const user = userEvent.setup();
        render(
            <SeriesScopeModal isOpen={true} onClose={vi.fn()} onConfirm={onConfirm} action="delete" />,
        );
        await user.click(screen.getByRole('radio', { name: 'All events in series' }));
        await user.click(screen.getByRole('button', { name: 'Delete' }));
        expect(onConfirm).toHaveBeenCalledWith('all');
    });

    it('selects "this_and_following" scope and confirms', async () => {
        const onConfirm = vi.fn();
        const user = userEvent.setup();
        render(
            <SeriesScopeModal isOpen={true} onClose={vi.fn()} onConfirm={onConfirm} action="cancel" />,
        );
        await user.click(screen.getByRole('radio', { name: 'This and following events' }));
        await user.click(screen.getByRole('button', { name: 'Cancel Events' }));
        expect(onConfirm).toHaveBeenCalledWith('this_and_following');
    });

    it('calls onClose when Back button is clicked', async () => {
        const onClose = vi.fn();
        const user = userEvent.setup();
        render(
            <SeriesScopeModal isOpen={true} onClose={onClose} onConfirm={vi.fn()} action="edit" />,
        );
        await user.click(screen.getByRole('button', { name: 'Back' }));
        expect(onClose).toHaveBeenCalledOnce();
    });
});
