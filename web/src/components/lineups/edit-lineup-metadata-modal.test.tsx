/**
 * EditLineupMetadataModal tests (ROK-1650 AC2, ruling "validation inline,
 * not toast-only"): a blank title is reported inline on blur, never by a
 * toast; server errors stay a toast.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
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

        expect(saveButton()).toBeDisabled();
        expect(toast.error).not.toHaveBeenCalledWith('Title is required');
        expect(m.mutateAsync).not.toHaveBeenCalled();
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
