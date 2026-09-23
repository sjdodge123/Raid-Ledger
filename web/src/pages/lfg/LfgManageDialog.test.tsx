/** ROK-1573 (approved H2) — ⋯ Manage: urgency choice + Withdraw danger row. */
import { describe, it, expect, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { LfgUrgency } from '@raid-ledger/contract';
import { renderWithProviders } from '../../test/render-helpers';
import { LfgManageDialog } from './LfgManageDialog';

function setup(
    ownUrgency: LfgUrgency | null = 'week',
    isWithdrawing = false,
    spawn: { spawnsNow?: boolean; spawnEmoji?: string } = {},
) {
    const onPickUrgency = vi.fn();
    const onWithdraw = vi.fn();
    const onClose = vi.fn();
    renderWithProviders(
        <LfgManageDialog
            isOpen
            gameName="Valheim"
            ownUrgency={ownUrgency}
            onPickUrgency={onPickUrgency}
            onWithdraw={onWithdraw}
            isWithdrawing={isWithdrawing}
            onClose={onClose}
            {...spawn}
        />,
    );
    return { onPickUrgency, onWithdraw, onClose };
}

describe('LfgManageDialog', () => {
    it('Withdraw calls onWithdraw', async () => {
        const { onWithdraw, onClose } = setup();
        const body = screen.getByTestId('lfg-manage-body');
        expect(body).toHaveTextContent("You're in · This week. Pick again to change it.");
        await userEvent.click(screen.getByTestId('lfg-manage-withdraw'));
        expect(onWithdraw).toHaveBeenCalledTimes(1);
        expect(onClose).not.toHaveBeenCalled();
    });

    it('picking an urgency hands the pick to onPickUrgency', async () => {
        const { onPickUrgency } = setup('now');
        expect(screen.getByTestId('lfg-manage-body')).toHaveTextContent("You're in · Right now.");
        await userEvent.click(screen.getByTestId('lfg-urgency-now'));
        expect(onPickUrgency).toHaveBeenCalledWith({ urgency: 'now', ttlMinutes: 30 });
    });

    it('names the tonight horizon it is holding (ROK-1616)', async () => {
        const { onPickUrgency } = setup('tonight');
        expect(screen.getByTestId('lfg-manage-body')).toHaveTextContent("You're in · Tonight.");
        await userEvent.click(screen.getByTestId('lfg-urgency-tonight'));
        expect(onPickUrgency).toHaveBeenCalledWith({ urgency: 'tonight' });
    });

    it('disables Withdraw while withdrawing', () => {
        setup('week', true);
        expect(screen.getByTestId('lfg-manage-withdraw')).toBeDisabled();
    });

    it('marks the Right now pick with the spawn glyph when it would form the group (ROK-1619 AC7)', () => {
        setup('week', false, { spawnsNow: true, spawnEmoji: '🎉' });
        const now = screen.getByTestId('lfg-urgency-now');
        expect(within(now).getByTestId('lfg-spawn-indicator')).toHaveTextContent('🎉');
    });

    it('shows no spawn glyph when the pick would not form the group (ROK-1619 AC7)', () => {
        setup('week', false, { spawnsNow: false, spawnEmoji: '🎉' });
        expect(screen.getByTestId('lfg-urgency-now')).toBeInTheDocument();
        expect(screen.queryByTestId('lfg-spawn-indicator')).not.toBeInTheDocument();
    });

    it('offers no Withdraw when the viewer holds no intent', () => {
        setup(null);
        expect(screen.getByTestId('lfg-urgency-choice')).toBeInTheDocument();
        expect(screen.queryByTestId('lfg-manage-withdraw')).not.toBeInTheDocument();
    });
});
