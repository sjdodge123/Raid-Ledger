/** ROK-2068 — the Manage my saves confirm step (Q3 ruling: markers cleared, so a re-sent save is added again). */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BG3_REMOVE_SAVES_RESEND_NOTE, Bg3RemoveSavesConfirm, Bg3RemoveSavesConfirmFooter } from './bg3-remove-saves-confirm';

describe('Bg3RemoveSavesConfirm', () => {
    it('counts the saves (singular) and never promises removed saves stay gone', () => {
        render(<Bg3RemoveSavesConfirm saves={1} capped={false} />);
        const body = screen.getByTestId('bg3-remove-saves-confirm');
        expect(body).toHaveTextContent("This deletes 1 save you uploaded and their pictures in hub Galleries. It can't be undone.");
        expect(body).toHaveTextContent(BG3_REMOVE_SAVES_RESEND_NOTE);
        expect(BG3_REMOVE_SAVES_RESEND_NOTE).toMatch(/added again/);
        expect(body).not.toHaveTextContent(/won't be added|stay removed|stay gone/);
    });

    it('reads the count as a floor when the list was capped', () => {
        render(<Bg3RemoveSavesConfirm saves={2000} capped />);
        expect(screen.getByTestId('bg3-remove-saves-confirm')).toHaveTextContent('This deletes 2000+ saves you uploaded');
    });
});

describe('Bg3RemoveSavesConfirmFooter', () => {
    it('Back and Remove saves call their handlers', async () => {
        const onBack = vi.fn();
        const onConfirm = vi.fn();
        render(<Bg3RemoveSavesConfirmFooter pending={false} onBack={onBack} onConfirm={onConfirm} />);
        const user = userEvent.setup();
        await user.click(screen.getByRole('button', { name: 'Back' }));
        await user.click(screen.getByRole('button', { name: 'Remove saves' }));
        expect(onBack).toHaveBeenCalledTimes(1);
        expect(onConfirm).toHaveBeenCalledTimes(1);
    });

    it('locks Back while the removal is in flight', () => {
        render(<Bg3RemoveSavesConfirmFooter pending onBack={vi.fn()} onConfirm={vi.fn()} />);
        expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled();
    });
});
