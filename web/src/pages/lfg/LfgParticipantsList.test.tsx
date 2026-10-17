/** ROK-1571 — the participants list the chip opens. */
import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../test/render-helpers';
import { createMockLfgMember } from '../../test/lfg-factories';
import { LfgParticipantsList } from './LfgParticipantsList';

const MEMBERS = [
    createMockLfgMember({ userId: 1, displayName: 'Ana', urgency: 'now', expiresAt: new Date(Date.now() + 20 * 60_000).toISOString() }),
    createMockLfgMember({ userId: 2, displayName: 'Bo', urgency: 'week' }),
];

describe('LfgParticipantsList', () => {
    it('lists every member with how soon they want to play', () => {
        renderWithProviders(<LfgParticipantsList isOpen members={MEMBERS} onClose={vi.fn()} />);
        const list = screen.getByTestId('lfg-participants-list');
        expect(list.querySelectorAll('li')).toHaveLength(2);
        const chips = screen.getAllByTestId('lfg-participant-urgency').map((c) => c.textContent);
        expect(chips[0]).toMatch(/^Right now · /);
        expect(chips[1]).toBe('This week');
        expect(screen.getByText('Participants · 2')).toBeInTheDocument();
    });

    it('renders nothing while closed', () => {
        renderWithProviders(<LfgParticipantsList isOpen={false} members={MEMBERS} onClose={vi.fn()} />);
        expect(screen.queryByTestId('lfg-participants-list')).not.toBeInTheDocument();
    });
});
