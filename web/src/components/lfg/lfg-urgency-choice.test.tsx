/**
 * ROK-1479 AC5 / ROK-1616 AC5 — the three-way urgency choice.
 *
 * ROK-1616 keeps the control three-wide but changes what the three MEAN:
 * `Right now` · `Tonight` · `This week`, not a `now` split into 30 and 60
 * minutes. The player is never shown a TTL again.
 *
 * TDD: `./lfg-urgency-choice` does not exist yet, so this file fails at
 * import. That is the intended pre-implementation failure.
 *
 * Pinned here:
 *   • three choices, labelled from `LFG_COPY` (never a literal in the JSX);
 *   • each is a real `<button type="button">`, so Enter/Space activate it
 *     without a keydown handler — the control has to be keyboard operable;
 *   • the `week` pick carries NO `ttlMinutes` key at all (A2: the contract
 *     REJECTS `{ urgency: 'week', ttlMinutes }`, so emitting `undefined`
 *     under that key would still be a 400 once it reaches `JSON.stringify`
 *     via a spread that a later refactor makes explicit).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { LFG_COPY } from '../../pages/lfg/lfg-copy';
import { LfgUrgencyChoice } from './lfg-urgency-choice';

function renderChoice(onPick = vi.fn()) {
    const view = render(
        <LfgUrgencyChoice label="Hearted Game 1" onPick={onPick} />,
    );
    return { ...view, onPick };
}

describe('LfgUrgencyChoice — the three choices', () => {
    it('renders exactly three buttons, all labelled from LFG_COPY', () => {
        renderChoice();

        const buttons = screen.getAllByRole('button');
        expect(buttons.map((b) => b.textContent)).toEqual([
            LFG_COPY.urgencyWeek,
            LFG_COPY.urgencyNow,
            LFG_COPY.urgencyTonight,
        ]);
        buttons.forEach((b) => expect(b).toHaveAttribute('type', 'button'));
    });

    it('names the group after the game it is choosing for', () => {
        renderChoice();

        expect(
            screen.getByRole('group', { name: /Hearted Game 1/ }),
        ).toBeInTheDocument();
    });

    it('has no accessibility violations', async () => {
        const { container } = renderChoice();

        expect(await axe(container)).toHaveNoViolations();
    });
});

describe('LfgUrgencyChoice — what it emits', () => {
    it('emits the weekly pick with NO ttlMinutes key (A2)', async () => {
        const user = userEvent.setup();
        const { onPick } = renderChoice();

        await user.click(screen.getByRole('button', { name: LFG_COPY.urgencyWeek }));

        expect(onPick).toHaveBeenCalledTimes(1);
        const pick = onPick.mock.calls[0][0];
        expect(pick).toEqual({ urgency: 'week' });
        expect(Object.keys(pick)).not.toContain('ttlMinutes');
    });

    it('emits the now pick with its 30-minute TTL, and tonight with none', async () => {
        const user = userEvent.setup();
        const { onPick } = renderChoice();

        await user.click(
            screen.getByRole('button', { name: LFG_COPY.urgencyNow }),
        );
        await user.click(
            screen.getByRole('button', { name: LFG_COPY.urgencyTonight }),
        );

        expect(onPick.mock.calls.map((c) => c[0])).toEqual([
            { urgency: 'now', ttlMinutes: 30 },
            { urgency: 'tonight' },
        ]);
        // `tonight` computes its own 04:00 expiry server-side; a TTL key on it
        // would be the same client bug A2 rejects for `week`.
        expect(Object.keys(onPick.mock.calls[1][0])).not.toContain(
            'ttlMinutes',
        );
    });

    it('is operable from the keyboard alone', async () => {
        const user = userEvent.setup();
        const { onPick } = renderChoice();

        // Tab reaches the first choice, Enter activates it...
        await user.tab();
        expect(
            screen.getByRole('button', { name: LFG_COPY.urgencyWeek }),
        ).toHaveFocus();
        await user.keyboard('{Enter}');
        expect(onPick).toHaveBeenLastCalledWith({ urgency: 'week' });

        // ...and Space activates the next one, which is what a native
        // <button> gives us and a clickable <div> would not.
        await user.tab();
        expect(
            screen.getByRole('button', { name: LFG_COPY.urgencyNow }),
        ).toHaveFocus();
        await user.keyboard('[Space]');
        expect(onPick).toHaveBeenLastCalledWith({
            urgency: 'now',
            ttlMinutes: 30,
        });
    });

    it('disables every choice while a join is in flight', () => {
        render(
            <LfgUrgencyChoice label="Hearted Game 1" disabled onPick={vi.fn()} />,
        );

        screen.getAllByRole('button').forEach((b) => expect(b).toBeDisabled());
    });
});
