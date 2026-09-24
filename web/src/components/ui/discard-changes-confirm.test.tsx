/**
 * ROK-1655 — the shared "Discard your changes?" confirm (relocated from
 * game-time, ROK-1640): a neutral default message, an optional override, Keep
 * editing takes the initial focus, and every non-Discard exit keeps the draft.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { DiscardChangesConfirm } from './discard-changes-confirm';

function setup(message?: string) {
    const onKeep = vi.fn();
    const onDiscard = vi.fn();
    render(<DiscardChangesConfirm isOpen onKeep={onKeep} onDiscard={onDiscard} message={message} />);
    return { onKeep, onDiscard };
}

describe('DiscardChangesConfirm', () => {
    it('shows the title and the neutral default message', () => {
        setup();
        expect(screen.getByText('Discard your changes?')).toBeInTheDocument();
        expect(screen.getByTestId('discard-changes-confirm')).toHaveTextContent("Your changes haven't been saved yet.");
    });

    it('shows a caller-supplied message in place of the default', () => {
        setup("Your new character hasn't been saved yet.");
        const body = screen.getByTestId('discard-changes-confirm');
        expect(body).toHaveTextContent("Your new character hasn't been saved yet.");
        expect(body).not.toHaveTextContent("Your changes haven't been saved yet.");
    });

    it('gives Keep editing the initial focus', async () => {
        setup();
        await waitFor(() => expect(screen.getByTestId('discard-changes-keep')).toHaveFocus());
    });

    it('keeps the draft on Keep editing, Escape and the backdrop', () => {
        const { onKeep, onDiscard } = setup();
        fireEvent.click(screen.getByTestId('discard-changes-keep'));
        fireEvent.keyDown(document, { key: 'Escape' });
        const backdrop = screen.getByRole('dialog').parentElement?.querySelector('[aria-hidden="true"]') as HTMLElement;
        fireEvent.click(backdrop);
        expect(onKeep).toHaveBeenCalledTimes(3);
        expect(onDiscard).not.toHaveBeenCalled();
    });

    it('discards on Discard', () => {
        const { onKeep, onDiscard } = setup();
        fireEvent.click(screen.getByTestId('discard-changes-discard'));
        expect(onDiscard).toHaveBeenCalledTimes(1);
        expect(onKeep).not.toHaveBeenCalled();
    });
});
