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

describe('DynamicCategoryEditModal', () => {
    it('prefills inputs from the suggestion', () => {
        render(
            <DynamicCategoryEditModal
                isOpen
                suggestion={SUGGESTION}
                onClose={() => {}}
                onSave={() => {}}
            />,
        );
        expect(screen.getByLabelText(/name/i)).toHaveValue('Original Name');
        expect(screen.getByLabelText(/description/i)).toHaveValue(
            'Original description',
        );
    });

    it('blocks save and shows validation errors when name is empty', async () => {
        const onSave = vi.fn();
        render(
            <DynamicCategoryEditModal
                isOpen
                suggestion={SUGGESTION}
                onClose={() => {}}
                onSave={onSave}
            />,
        );
        fireEvent.change(screen.getByLabelText(/name/i), {
            target: { value: '' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));
        expect(await screen.findByText(/name is required/i)).toBeInTheDocument();
        expect(onSave).not.toHaveBeenCalled();
    });

    it('calls onSave with patched fields when valid', async () => {
        const onSave = vi.fn();
        render(
            <DynamicCategoryEditModal
                isOpen
                suggestion={SUGGESTION}
                onClose={() => {}}
                onSave={onSave}
            />,
        );
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
