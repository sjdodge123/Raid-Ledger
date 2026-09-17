/** ROK-1573 (approved H2) — ⋯ Manage: urgency choice + Withdraw danger row. */
import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { LfgUrgency } from '@raid-ledger/contract';
import { renderWithProviders } from '../../test/render-helpers';
import { LfgManageDialog } from './LfgManageDialog';

function setup(ownUrgency: LfgUrgency | null = 'week', isWithdrawing = false) {
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
        await userEvent.click(screen.getByTestId('lfg-urgency-now-30'));
        expect(onPickUrgency).toHaveBeenCalledWith({ urgency: 'now', ttlMinutes: 30 });
    });

    it('disables Withdraw while withdrawing', () => {
        setup('week', true);
        expect(screen.getByTestId('lfg-manage-withdraw')).toBeDisabled();
    });

    it('offers no Withdraw when the viewer holds no intent', () => {
        setup(null);
        expect(screen.getByTestId('lfg-urgency-choice')).toBeInTheDocument();
        expect(screen.queryByTestId('lfg-manage-withdraw')).not.toBeInTheDocument();
    });
});
