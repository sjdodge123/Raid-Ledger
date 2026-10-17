/** ROK-1571 — the Participants chip. */
import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/render-helpers';
import { createMockLfgMember } from '../../test/lfg-factories';
import { LfgParticipantsChip } from './LfgParticipantsChip';

const MEMBERS = [
    createMockLfgMember({ userId: 1, displayName: 'Ana', urgency: 'now', expiresAt: new Date(Date.now() + 20 * 60_000).toISOString() }),
    createMockLfgMember({ userId: 2, displayName: 'Bo', urgency: 'week' }),
];

describe('LfgParticipantsChip', () => {
    it('shows the count and opens on click', async () => {
        const onOpen = vi.fn();
        renderWithProviders(<LfgParticipantsChip members={MEMBERS} onOpen={onOpen} />);
        const chip = screen.getByTestId('lfg-participants-chip');
        expect(chip).toHaveTextContent('Participants · 2');
        expect(chip).toHaveAttribute('aria-label', 'Participants · 2');
        expect(chip.className).toContain('min-h-[44px]');
        await userEvent.click(chip);
        expect(onOpen).toHaveBeenCalledTimes(1);
    });
});
