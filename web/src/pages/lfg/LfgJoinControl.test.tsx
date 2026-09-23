/**
 * ROK-1619 AC7 — the web join control carries the indicator glyph on the `+1`
 * opener (as the Discord `+1`/`Join` buttons do) and marks the `Right now`
 * pick (the press that forms the group) with the glyph and the words — only
 * when the group read says this viewer's pick would cross the spawn threshold.
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
    });

    // Operator plan 2026-09-23-1758-bb8d step 3: the Discord `+1`/`Join`
    // buttons wore the emoji, the web `+1 · I'm in` did not.
    it('leads the +1 opener with the same glyph the Discord buttons carry', () => {
        renderControl({ spawnsNow: true, spawnEmoji: '🎉' });
        const opener = screen.getByTestId('lfg-join-button');
        expect(opener).toHaveTextContent("🎉 +1 · I'm in");
        expect(screen.getByTestId('lfg-join-spawn-indicator')).toHaveAttribute('aria-hidden', 'true');
        // The words stay on the `Right now` pick: only it forms the group (AC6).
        expect(opener).not.toHaveTextContent('starts the group');
    });

    // The server resolves the glyph (🎉 by default) and always sends it with the
    // flag; the web keeps no default of its own that could drift from it.
    it('draws no glyph of its own when the read carries none', () => {
        renderControl({ spawnsNow: true });
        expect(screen.queryByTestId('lfg-spawn-indicator')).toBeNull();
        expect(screen.queryByTestId('lfg-join-spawn-indicator')).toBeNull();
    });

    it.each([false, undefined])('shows no indicator when spawnsNow is %s', (spawnsNow) => {
        const now = renderControl({ spawnsNow, spawnEmoji: '🎉' });
        expect(now).toHaveTextContent('Right now');
        expect(now).not.toHaveTextContent('starts the group');
        expect(screen.queryByTestId('lfg-spawn-indicator')).toBeNull();
        expect(screen.queryByTestId('lfg-join-spawn-indicator')).toBeNull();
        expect(screen.getByTestId('lfg-join-button')).toHaveTextContent(/^\+1 · I'm in$/);
    });

    it('still joins with the now pick when marked', () => {
        const onJoin = vi.fn();
        render(<LfgJoinControl label="Valheim" onJoin={onJoin} className="btn" spawnsNow />);
        fireEvent.click(screen.getByTestId('lfg-join-button'));
        fireEvent.click(screen.getByTestId('lfg-urgency-now'));
        expect(onJoin).toHaveBeenCalledWith({ urgency: 'now', ttlMinutes: 30 });
    });
});
