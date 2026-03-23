/**
 * Tests for NominationCard (ROK-935).
 * Validates game name, nominator, ownership badge, pricing, and delete button.
 */
import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/render-helpers';
import { createMockEntry } from '../../test/lineup-factories';
import { NominationCard } from './NominationCard';

vi.mock('../../hooks/use-auth', () => ({
    useAuth: vi.fn(() => ({ user: { id: 99, role: 'member' } })),
    isOperatorOrAdmin: vi.fn(() => false),
}));

import { useAuth, isOperatorOrAdmin } from '../../hooks/use-auth';

describe('NominationCard — basic rendering', () => {
    it('renders game name', () => {
        renderWithProviders(
            <NominationCard entry={createMockEntry()} onRemove={vi.fn()} />,
        );
        expect(screen.getByText('Valheim')).toBeInTheDocument();
    });

    it('renders nominator display name', () => {
        renderWithProviders(
            <NominationCard
                entry={createMockEntry({ nominatedBy: { id: 5, displayName: 'Alice' } })}
                onRemove={vi.fn()}
            />,
        );
        expect(screen.getByText(/by Alice/)).toBeInTheDocument();
    });

    it('renders cover image when available', () => {
        renderWithProviders(
            <NominationCard entry={createMockEntry({ gameCoverUrl: '/cover.jpg' })} onRemove={vi.fn()} />,
        );
        expect(screen.getByAltText('Valheim')).toBeInTheDocument();
    });
});

describe('NominationCard — ownership badge', () => {
    it('shows owner count and total members', () => {
        renderWithProviders(
            <NominationCard entry={createMockEntry({ ownerCount: 6, totalMembers: 10 })} onRemove={vi.fn()} />,
        );
        expect(screen.getByText(/6\/10 own/)).toBeInTheDocument();
    });
});

describe('NominationCard — pricing', () => {
    it('displays price for non-owners when available', () => {
        renderWithProviders(
            <NominationCard
                entry={createMockEntry({ itadCurrentPrice: 14.99, nonOwnerCount: 4 })}
                onRemove={vi.fn()}
            />,
        );
        expect(screen.getByText(/\$14.99/)).toBeInTheDocument();
    });

    it('shows no pricing text when price is null', () => {
        renderWithProviders(
            <NominationCard
                entry={createMockEntry({ itadCurrentPrice: null })}
                onRemove={vi.fn()}
            />,
        );
        expect(screen.queryByText(/\$/)).not.toBeInTheDocument();
    });
});

describe('NominationCard — note', () => {
    it('renders note in italic when present', () => {
        renderWithProviders(
            <NominationCard entry={createMockEntry({ note: 'Great co-op game' })} onRemove={vi.fn()} />,
        );
        expect(screen.getByText(/Great co-op game/)).toBeInTheDocument();
    });

    it('does not render note area when note is null', () => {
        renderWithProviders(
            <NominationCard entry={createMockEntry({ note: null })} onRemove={vi.fn()} />,
        );
        expect(screen.queryByText(/Great co-op game/)).not.toBeInTheDocument();
    });
});

describe('NominationCard — delete button', () => {
    it('shows delete button when user is the nominator', () => {
        vi.mocked(useAuth).mockReturnValue({ user: { id: 1, role: 'member' } } as ReturnType<typeof useAuth>);
        vi.mocked(isOperatorOrAdmin).mockReturnValue(false);
        renderWithProviders(
            <NominationCard
                entry={createMockEntry({ nominatedBy: { id: 1, displayName: 'Me' } })}
                onRemove={vi.fn()}
            />,
        );
        expect(screen.getByRole('button', { name: /remove/i })).toBeInTheDocument();
    });

    it('shows delete button when user is operator', () => {
        vi.mocked(useAuth).mockReturnValue({ user: { id: 99, role: 'operator' } } as ReturnType<typeof useAuth>);
        vi.mocked(isOperatorOrAdmin).mockReturnValue(true);
        renderWithProviders(
            <NominationCard
                entry={createMockEntry({ nominatedBy: { id: 5, displayName: 'Other' } })}
                onRemove={vi.fn()}
            />,
        );
        expect(screen.getByRole('button', { name: /remove/i })).toBeInTheDocument();
    });

    it('hides delete button for non-nominator members', () => {
        vi.mocked(useAuth).mockReturnValue({ user: { id: 99, role: 'member' } } as ReturnType<typeof useAuth>);
        vi.mocked(isOperatorOrAdmin).mockReturnValue(false);
        renderWithProviders(
            <NominationCard
                entry={createMockEntry({ nominatedBy: { id: 5, displayName: 'Other' } })}
                onRemove={vi.fn()}
            />,
        );
        expect(screen.queryByRole('button', { name: /remove/i })).not.toBeInTheDocument();
    });

    it('calls onRemove when delete button is clicked', async () => {
        const user = userEvent.setup();
        vi.mocked(useAuth).mockReturnValue({ user: { id: 1, role: 'member' } } as ReturnType<typeof useAuth>);
        vi.mocked(isOperatorOrAdmin).mockReturnValue(false);
        const onRemove = vi.fn();
        renderWithProviders(
            <NominationCard
                entry={createMockEntry({ gameId: 42, nominatedBy: { id: 1, displayName: 'Me' } })}
                onRemove={onRemove}
            />,
        );
        await user.click(screen.getByRole('button', { name: /remove/i }));
        expect(onRemove).toHaveBeenCalledWith(42);
    });
});
