import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
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

    it('renders all three scope options', () => {
        render(
            <SeriesScopeModal isOpen={true} onClose={vi.fn()} onConfirm={vi.fn()} action="edit" />,
        );
        expect(screen.getByText('This event only')).toBeInTheDocument();
        expect(screen.getByText('This and following events')).toBeInTheDocument();
        expect(screen.getByText('All events in series')).toBeInTheDocument();
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

    it('shows Processing... when isPending is true', () => {
        render(
            <SeriesScopeModal isOpen={true} onClose={vi.fn()} onConfirm={vi.fn()} action="edit" isPending />,
        );
        expect(screen.getByRole('button', { name: 'Processing...' })).toBeDisabled();
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
        await user.click(screen.getByRole('button', { name: 'Continue' }));
        expect(onConfirm).toHaveBeenCalledWith('this');
    });

    it('selects "all" scope and confirms with it', async () => {
        const onConfirm = vi.fn();
        const user = userEvent.setup();
        render(
            <SeriesScopeModal isOpen={true} onClose={vi.fn()} onConfirm={onConfirm} action="delete" />,
        );
        await user.click(screen.getByText('All events in series'));
        await user.click(screen.getByRole('button', { name: 'Delete' }));
        expect(onConfirm).toHaveBeenCalledWith('all');
    });

    it('selects "this_and_following" scope and confirms', async () => {
        const onConfirm = vi.fn();
        const user = userEvent.setup();
        render(
            <SeriesScopeModal isOpen={true} onClose={vi.fn()} onConfirm={onConfirm} action="cancel" />,
        );
        await user.click(screen.getByText('This and following events'));
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
