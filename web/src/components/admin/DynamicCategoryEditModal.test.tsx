import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { DiscoveryCategorySuggestionDto } from '@raid-ledger/contract';
import { DynamicCategoryEditModal } from './DynamicCategoryEditModal';

const SUGGESTION: DiscoveryCategorySuggestionDto = {
    id: '33333333-3333-4333-8333-333333333333',
    name: 'Original Name',
    description: 'Original description',
    categoryType: 'trend',
    themeVector: [0, 0, 0, 0, 0, 0, 0],
    filterCriteria: {},
    candidateGameIds: [],
    status: 'pending',
    populationStrategy: 'vector',
    sortOrder: 0,
    expiresAt: null,
    generatedAt: '2026-04-22T00:00:00.000Z',
    reviewedBy: null,
    reviewedAt: null,
    createdAt: '2026-04-22T00:00:00.000Z',
};

function renderModal(onSave = vi.fn(), isSaving = false) {
    render(
        <DynamicCategoryEditModal
            isOpen
            suggestion={SUGGESTION}
            onClose={() => {}}
            onSave={onSave}
            isSaving={isSaving}
        />,
    );
    return onSave;
}

describe('DynamicCategoryEditModal', () => {
    it('prefills inputs from the suggestion', () => {
        renderModal();
        expect(screen.getByLabelText(/name/i)).toHaveValue('Original Name');
        expect(screen.getByLabelText(/description/i)).toHaveValue(
            'Original description',
        );
    });

    it('blocks save and shows validation errors when name is empty', async () => {
        const onSave = vi.fn();
        renderModal(onSave);
        fireEvent.change(screen.getByLabelText(/name/i), {
            target: { value: '' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));
        expect(await screen.findByText(/name is required/i)).toBeInTheDocument();
        expect(onSave).not.toHaveBeenCalled();
    });

    it('calls onSave with patched fields when valid', async () => {
        const onSave = vi.fn();
        renderModal(onSave);
        fireEvent.change(screen.getByLabelText(/name/i), {
            target: { value: 'Renamed' },
        });
        fireEvent.change(screen.getByLabelText(/description/i), {
            target: { value: 'New desc' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));
        await waitFor(() => {
            expect(onSave).toHaveBeenCalledWith(SUGGESTION.id, {
                name: 'Renamed',
                description: 'New desc',
            });
        });
    });

    it('returns null when no suggestion is supplied', () => {
        const { container } = render(
            <DynamicCategoryEditModal
                isOpen
                suggestion={null}
                onClose={() => {}}
                onSave={() => {}}
            />,
        );
        expect(container).toBeEmptyDOMElement();
    });
});

/*
 * ROK-1653 G5b (AC2b): the fields are shared `Field`s, so a failed save marks
 * the control invalid and ties it to a role=alert message; Save is a loading
 * `Button` (ruling 7: aria-busy + aria-disabled + a swallowed click, never
 * native `disabled`).
 */
describe('DynamicCategoryEditModal — Field + Button (ROK-1653)', () => {
    it('an empty name on Save marks Name aria-invalid, described by a role=alert "Name is required"', async () => {
        renderModal();
        // Exact label, mirroring the smoke's getByLabel(/^Name$/i): no asterisk.
        const name = screen.getByLabelText(/^Name$/i);
        fireEvent.change(name, { target: { value: '' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));
        const message = await screen.findByText('Name is required');
        expect(name).toHaveAttribute('aria-invalid', 'true');
        expect(message).toHaveAttribute('role', 'alert');
        expect(message.id).not.toBe('');
        expect(name.getAttribute('aria-describedby')?.split(' ')).toContain(message.id);
        expect(screen.getByLabelText(/^Description$/i)).not.toHaveAttribute('aria-invalid', 'true');
    });

    it('a pending Save is aria-busy + aria-disabled, named "Saving…", and swallows a click (ruling 7)', () => {
        const onSave = renderModal(vi.fn(), true);
        const save = screen.getByRole('button', { name: 'Saving…' });
        expect(save).toHaveAttribute('aria-busy', 'true');
        expect(save).toHaveAttribute('aria-disabled', 'true');
        fireEvent.click(save);
        expect(onSave).not.toHaveBeenCalled();
    });
});
