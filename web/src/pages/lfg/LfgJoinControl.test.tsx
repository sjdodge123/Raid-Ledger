/**
 * ROK-1619 AC7 — the web join control marks the `Right now` pick (the press
 * that forms the group), never the `+1` opener, and only when the group read
 * says this viewer's pick would cross the spawn threshold.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { LfgJoinControl } from './LfgJoinControl';

function renderControl(props: { spawnsNow?: boolean; spawnEmoji?: string }) {
    render(<LfgJoinControl label="Valheim" onJoin={vi.fn()} className="btn" {...props} />);
    fireEvent.click(screen.getByTestId('lfg-join-button'));
    return screen.getByTestId('lfg-urgency-now');
}

describe('LfgJoinControl — ROK-1619 spawn indicator', () => {
    it('marks the Right now pick with the configured glyph and the words', () => {
        const now = renderControl({ spawnsNow: true, spawnEmoji: '☀️' });
        expect(now).toHaveTextContent('Right now · starts the group');
        expect(screen.getByTestId('lfg-spawn-indicator')).toHaveTextContent('☀️');
        expect(screen.getByTestId('lfg-spawn-indicator')).toHaveAttribute('aria-hidden', 'true');
        expect(screen.getByTestId('lfg-join-button')).not.toHaveTextContent('starts the group');
    });

    it('falls back to 🎉 when the read carries no glyph', () => {
        renderControl({ spawnsNow: true });
        expect(screen.getByTestId('lfg-spawn-indicator')).toHaveTextContent('🎉');
    });

    it.each([false, undefined])('shows no indicator when spawnsNow is %s', (spawnsNow) => {
        const now = renderControl({ spawnsNow, spawnEmoji: '🎉' });
        expect(now).toHaveTextContent('Right now');
        expect(now).not.toHaveTextContent('starts the group');
        expect(screen.queryByTestId('lfg-spawn-indicator')).toBeNull();
    });

    it('still joins with the now pick when marked', () => {
        const onJoin = vi.fn();
        render(<LfgJoinControl label="Valheim" onJoin={onJoin} className="btn" spawnsNow />);
        fireEvent.click(screen.getByTestId('lfg-join-button'));
        fireEvent.click(screen.getByTestId('lfg-urgency-now'));
        expect(onJoin).toHaveBeenCalledWith({ urgency: 'now', ttlMinutes: 30 });
    });
});
