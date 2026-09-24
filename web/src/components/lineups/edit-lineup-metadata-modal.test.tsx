/**
 * EditLineupMetadataModal tests (ROK-1650 AC2, ruling "validation inline,
 * not toast-only"): a blank title is reported inline on blur, never by a
 * toast; server errors stay a toast. ROK-1655 (C5b): unsaved edits ask
 * before Escape, × or Cancel discard them; Cancel + Save sit in the pinned
 * footer and Save submits the form through `form=`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, screen, fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/render-helpers';
import { EditLineupMetadataModal } from './edit-lineup-metadata-modal';

vi.mock('../../hooks/use-lineups', () => ({
    useUpdateLineupMetadata: vi.fn(),
}));

vi.mock('../../lib/toast', () => ({
    toast: { success: vi.fn(), error: vi.fn() },
}));

import { useUpdateLineupMetadata } from '../../hooks/use-lineups';
import { toast } from '../../lib/toast';

type MutationLike = { mutateAsync: ReturnType<typeof vi.fn>; isPending: boolean };

function mockMutation(overrides: Partial<MutationLike> = {}): MutationLike {
    const m: MutationLike = { mutateAsync: vi.fn().mockResolvedValue({ id: 7 }), isPending: false, ...overrides };
    vi.mocked(useUpdateLineupMetadata).mockReturnValue(
        m as unknown as ReturnType<typeof useUpdateLineupMetadata>,
    );
    return m;
}

function renderModal(initialTitle = 'Friday Lineup', initialDescription: string | null = null) {
    const onClose = vi.fn();
    renderWithProviders(
        <EditLineupMetadataModal
            lineupId={7}
            initialTitle={initialTitle}
            initialDescription={initialDescription}
            onClose={onClose}
        />,
    );
    return { onClose };
}

const titleInput = () => screen.getByRole('textbox', { name: /^Title/ });
const saveButton = () => screen.getByRole('button', { name: /^Save/ });

describe('EditLineupMetadataModal — inline title validation', () => {
    beforeEach(() => vi.clearAllMocks());

    it('shows "Title is required" inline once the cleared title is left', () => {
        mockMutation();
        renderModal();
        fireEvent.change(titleInput(), { target: { value: '   ' } });
        fireEvent.blur(titleInput());

        const alert = screen.getByRole('alert');
        expect(alert).toHaveTextContent('Title is required');
        expect(titleInput()).toHaveAttribute('aria-invalid', 'true');
        expect(titleInput().getAttribute('aria-describedby') ?? '').toContain(alert.id);
        expect(alert.id).not.toBe('');
    });

    it('never toasts "Title is required" and keeps Save disabled while blank', () => {
        const m = mockMutation();
        renderModal();
        fireEvent.change(titleInput(), { target: { value: '' } });
        fireEvent.blur(titleInput());
        fireEvent.click(saveButton());

        expect(toast.error).not.toHaveBeenCalledWith('Title is required');
        expect(m.mutateAsync).not.toHaveBeenCalled();
        expect(saveButton()).toBeDisabled();
    });

    it('does not flag the title before the field has been left', () => {
        mockMutation();
        renderModal('');
        expect(screen.queryByRole('alert')).toBeNull();
        expect(titleInput()).not.toHaveAttribute('aria-invalid', 'true');
    });

    it('drops the raw rose asterisk for the Field primitive (ruling 9)', () => {
        mockMutation();
        renderModal();
        expect(document.body.querySelector('.text-rose-400')).toBeNull();
        expect(document.body.querySelector('[class*="emerald-500/50"]')).toBeNull();
    });
});

describe('EditLineupMetadataModal — save', () => {
    beforeEach(() => vi.clearAllMocks());

    it('saves the trimmed title and a null blank description', async () => {
        const m = mockMutation();
        const { onClose } = renderModal('Friday Lineup', 'old');
        fireEvent.change(titleInput(), { target: { value: '  Saturday Lineup  ' } });
        fireEvent.change(screen.getByRole('textbox', { name: /^Description/ }), { target: { value: '  ' } });
        fireEvent.click(saveButton());

        await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
        expect(m.mutateAsync).toHaveBeenCalledWith({
            lineupId: 7,
            body: { title: 'Saturday Lineup', description: null },
        });
        expect(toast.success).toHaveBeenCalledWith('Lineup updated');
    });

    it('keeps server errors as a toast and stays open', async () => {
        mockMutation({ mutateAsync: vi.fn().mockRejectedValue(new Error('Lineup is archived')) });
        const { onClose } = renderModal();
        fireEvent.click(saveButton());

        await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Lineup is archived'));
        expect(onClose).not.toHaveBeenCalled();
    });

    it('marks Save busy (aria-busy + aria-disabled) while pending (ruling 7)', () => {
        mockMutation({ isPending: true });
        renderModal();
        const save = screen.getByRole('button', { name: /Saving/ });
        expect(save).toHaveAttribute('aria-busy', 'true');
        expect(save).toHaveAttribute('aria-disabled', 'true');
    });

    it('counts the description against its 500-character limit', () => {
        mockMutation();
        renderModal('Friday Lineup', 'hello');
        const description = screen.getByRole('textbox', { name: /^Description/ });
        expect(description).toHaveAttribute('maxLength', '500');
        expect(screen.getByTestId('textarea-count')).toHaveTextContent('5/500');
    });
});

/*
 * ROK-1655 (ROK-1650 C5b): an edited title or description must not vanish on
 * Escape, × or the explicit Cancel (ruling 4) — each asks "Discard your
 * changes?". A clean form (null description included) still closes at once.
 */
const CONFIRM = 'Discard your changes?';
/** Let the guard's one-macrotask Escape latch clear. */
const settle = (): Promise<void> => act(() => new Promise((r) => { setTimeout(r, 0); }));
const editDialog = (): HTMLElement => screen.getByRole('dialog', { name: 'Edit Lineup' });
const descriptionInput = () => screen.getByRole('textbox', { name: /^Description/ });

describe('EditLineupMetadataModal — dirty-close guard (ROK-1655)', () => {
    beforeEach(() => vi.clearAllMocks());

    it('a clean Escape closes at once with no confirm (null description is clean)', async () => {
        mockMutation();
        const { onClose } = renderModal('Friday Lineup', null);
        await userEvent.keyboard('{Escape}');
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(screen.queryByText(CONFIRM)).not.toBeInTheDocument();
    });

    it('after editing the description, Escape asks; Keep editing keeps the edits', async () => {
        mockMutation();
        const user = userEvent.setup();
        const { onClose } = renderModal('Friday Lineup', 'old');
        fireEvent.change(descriptionInput(), { target: { value: 'new plan' } });
        await user.keyboard('{Escape}');
        expect(onClose, 'a dirty Escape must not close').not.toHaveBeenCalled();
        expect(screen.getByText(CONFIRM)).toBeInTheDocument();

        await user.click(screen.getByTestId('discard-changes-keep'));
        await settle();
        expect(screen.queryByText(CONFIRM)).not.toBeInTheDocument();
        expect(onClose).not.toHaveBeenCalled();
        expect(editDialog()).toBeInTheDocument();
        expect(descriptionInput(), 'Keep must leave the edit in place').toHaveValue('new plan');
    });

    it('after editing the description, × asks; Discard calls onClose', async () => {
        mockMutation();
        const user = userEvent.setup();
        const { onClose } = renderModal();
        fireEvent.change(descriptionInput(), { target: { value: 'bring snacks' } });
        await user.click(within(editDialog()).getByRole('button', { name: 'Close modal' }));
        expect(onClose, 'a dirty × must not close').not.toHaveBeenCalled();
        expect(screen.getByText(CONFIRM)).toBeInTheDocument();

        await user.click(screen.getByTestId('discard-changes-discard'));
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(screen.queryByText(CONFIRM)).not.toBeInTheDocument();
    });

    it('the explicit Cancel is guarded too once the title is edited (ruling 4)', async () => {
        mockMutation();
        const user = userEvent.setup();
        const { onClose } = renderModal();
        fireEvent.change(titleInput(), { target: { value: 'Saturday Lineup' } });
        await user.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(onClose, 'a dirty Cancel must ask first').not.toHaveBeenCalled();
        expect(screen.getByText(CONFIRM)).toBeInTheDocument();
    });

    it('a clean Cancel closes at once', async () => {
        mockMutation();
        const { onClose } = renderModal();
        await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(screen.queryByText(CONFIRM)).not.toBeInTheDocument();
    });
});

describe('EditLineupMetadataModal — pinned footer (ROK-1655)', () => {
    beforeEach(() => vi.clearAllMocks());

    it('Cancel and Save sit in the modal-footer, outside the scrolling body', () => {
        mockMutation();
        renderModal();
        const footer = screen.queryByTestId('modal-footer');
        expect(footer, 'the Modal must render its pinned footer').not.toBeNull();
        expect(footer!, 'Save must be in the pinned footer').toContainElement(saveButton());
        expect(footer!).toContainElement(screen.getByRole('button', { name: 'Cancel' }));
        const body = footer!.previousElementSibling as HTMLElement;
        expect(body).toContainElement(titleInput());
        expect(body, 'the scroll body must not hold Save').not.toContainElement(saveButton());
    });

    it('Save is a submit button tied to the form by form=', () => {
        mockMutation();
        renderModal();
        const form = titleInput().closest('form');
        expect(form, 'the fields must sit in a <form>').not.toBeNull();
        expect(saveButton()).toHaveAttribute('type', 'submit');
        expect(saveButton()).toHaveAttribute('form', form!.id);
        expect((saveButton() as HTMLButtonElement).form, 'Save must be owned by the form').toBe(form);
    });

    it('clicking Save submits the form', async () => {
        const m = mockMutation();
        renderModal();
        const onSubmit = vi.fn();
        titleInput().closest('form')?.addEventListener('submit', onSubmit);
        fireEvent.click(saveButton());
        expect(onSubmit, 'Save must submit through form=').toHaveBeenCalledTimes(1);
        await waitFor(() => expect(m.mutateAsync).toHaveBeenCalledTimes(1));
    });

    it('pressing Enter in the title saves', async () => {
        const m = mockMutation();
        const user = userEvent.setup();
        const { onClose } = renderModal();
        await user.clear(titleInput());
        await user.type(titleInput(), 'Sunday Lineup{Enter}');
        expect(m.mutateAsync, 'Enter in the title must submit the form').toHaveBeenCalledWith({
            lineupId: 7,
            body: { title: 'Sunday Lineup', description: null },
        });
        await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
        expect(screen.queryByText(CONFIRM), 'a save must not ask to discard').not.toBeInTheDocument();
    });
});
