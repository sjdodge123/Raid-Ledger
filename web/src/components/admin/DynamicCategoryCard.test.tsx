import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { DiscoveryCategorySuggestionDto } from '@raid-ledger/contract';
import { DynamicCategoryCard } from './DynamicCategoryCard';

const BASE: DiscoveryCategorySuggestionDto = {
    id: '22222222-2222-4222-8222-222222222222',
    name: 'Cozy Winter Builders',
    description: 'Relaxed crafting and base-building in snowy settings.',
    categoryType: 'seasonal',
    themeVector: [0.3, -0.2, 0.1, 0.7, 0.4, 0.2, 0.0],
    filterCriteria: {},
    candidateGameIds: [1, 2, 3],
    status: 'pending',
    populationStrategy: 'vector',
    sortOrder: 1,
    expiresAt: null,
    generatedAt: '2026-04-22T00:00:00.000Z',
    reviewedBy: null,
    reviewedAt: null,
    createdAt: '2026-04-22T00:00:00.000Z',
};

describe('DynamicCategoryCard', () => {
    it('renders name, description and category type', () => {
        render(<DynamicCategoryCard suggestion={BASE} />);
        expect(screen.getByText(BASE.name)).toBeInTheDocument();
        expect(screen.getByText(BASE.description)).toBeInTheDocument();
        expect(screen.getByText(/seasonal/i)).toBeInTheDocument();
    });

    it('exposes data-status for smoke test polling', () => {
        render(<DynamicCategoryCard suggestion={BASE} />);
        const card = screen.getByTestId('dynamic-category-card');
        expect(card).toHaveAttribute('data-status', 'pending');
    });

    it('renders candidate count', () => {
        render(<DynamicCategoryCard suggestion={BASE} />);
        expect(screen.getByText(/3 candidate games/i)).toBeInTheDocument();
    });

    it('warns when candidate list is empty', () => {
        render(
            <DynamicCategoryCard
                suggestion={{ ...BASE, candidateGameIds: [] }}
            />,
        );
        expect(
            screen.getByText(/waiting on taste vectors/i),
        ).toBeInTheDocument();
    });

    it('calls onApprove with the id', () => {
        const onApprove = vi.fn();
        render(
            <DynamicCategoryCard suggestion={BASE} onApprove={onApprove} />,
        );
        fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
        expect(onApprove).toHaveBeenCalledWith(BASE.id);
    });

    it('calls onReject with the id', () => {
        const onReject = vi.fn();
        render(
            <DynamicCategoryCard suggestion={BASE} onReject={onReject} />,
        );
        fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
        expect(onReject).toHaveBeenCalledWith(BASE.id);
    });

    it('calls onEdit with the suggestion', () => {
        const onEdit = vi.fn();
        render(<DynamicCategoryCard suggestion={BASE} onEdit={onEdit} />);
        fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
        expect(onEdit).toHaveBeenCalledWith(BASE);
    });

    it('disables approve/reject when already approved', () => {
        render(
            <DynamicCategoryCard
                suggestion={{ ...BASE, status: 'approved' }}
            />,
        );
        expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Reject' })).toBeDisabled();
    });
});
