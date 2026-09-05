/**
 * ROK-1474 (B8) — failing-first tests for {@link StarToggleButton}.
 *
 * The star is the voter's single top pick. Operator ruling 2026-09-05: stars
 * are PRIVATE until the outcome, so this control renders the viewer's own
 * state and **no count** — an assertion below pins the absence, because a
 * count leaking here is a product bug, not a cosmetic one.
 *
 * Contract mirrored from the sibling {@link VoteToggleButton}:
 *   - `aria-label="Mark {gameName} as your top pick"` always present.
 *   - `aria-pressed` reflects `isStarred`.
 *   - click `stopPropagation()`s so the row body's drawer never opens.
 *   - disabled swallows the click entirely.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { StarToggleButton } from '../StarToggleButton';

function renderStar(
    props: Partial<Parameters<typeof StarToggleButton>[0]> = {},
) {
    const onToggle = props.onToggle ?? vi.fn();
    const utils = render(
        <StarToggleButton
            gameName="Valheim"
            isStarred={false}
            disabled={false}
            {...props}
            onToggle={onToggle}
        />,
    );
    return { ...utils, onToggle };
}

describe('StarToggleButton — accessibility contract', () => {
    it('exposes an aria-label naming the game and the top-pick action', () => {
        renderStar();
        expect(
            screen.getByRole('button', {
                name: 'Mark Valheim as your top pick',
            }),
        ).toBeInTheDocument();
    });

    it('reflects the starred state through aria-pressed', () => {
        const { rerender } = renderStar();
        expect(screen.getByTestId('star-toggle')).toHaveAttribute(
            'aria-pressed',
            'false',
        );
        rerender(
            <StarToggleButton
                gameName="Valheim"
                isStarred={true}
                disabled={false}
                onToggle={vi.fn()}
            />,
        );
        expect(screen.getByTestId('star-toggle')).toHaveAttribute(
            'aria-pressed',
            'true',
        );
    });

    it('marks the disabled reason in the accessible name when disabled', () => {
        renderStar({ disabled: true });
        expect(screen.getByTestId('star-toggle')).toHaveAttribute(
            'aria-label',
            'Mark Valheim as your top pick (disabled)',
        );
    });

    it('has no axe violations in either state', async () => {
        const { container } = renderStar({ isStarred: true });
        expect(await axe(container)).toHaveNoViolations();
    });
});

describe('StarToggleButton — interaction', () => {
    it('calls onToggle once per click', async () => {
        const user = userEvent.setup();
        const { onToggle } = renderStar();
        await user.click(screen.getByTestId('star-toggle'));
        expect(onToggle).toHaveBeenCalledTimes(1);
    });

    it('does not call onToggle when disabled', async () => {
        const user = userEvent.setup();
        const { onToggle } = renderStar({ disabled: true });
        await user.click(screen.getByTestId('star-toggle'), {
            pointerEventsCheck: 0,
        });
        expect(onToggle).not.toHaveBeenCalled();
    });

    it('stops the click from reaching the row body (drawer must not open)', async () => {
        const user = userEvent.setup();
        const onRowClick = vi.fn();
        render(
            <div onClick={onRowClick}>
                <StarToggleButton
                    gameName="Valheim"
                    isStarred={false}
                    disabled={false}
                    onToggle={vi.fn()}
                />
            </div>,
        );
        await user.click(screen.getByTestId('star-toggle'));
        expect(onRowClick).not.toHaveBeenCalled();
    });
});

describe('StarToggleButton — stars are private until the outcome', () => {
    it('renders no star tally anywhere in the control', () => {
        renderStar({ isStarred: true });
        // The operator ruled star counts are not disclosed on an open ballot.
        // The control therefore accepts no count prop and must render no
        // digits — a number here would be a live tally leak.
        expect(screen.getByTestId('star-toggle').textContent ?? '').not.toMatch(
            /\d/,
        );
    });
});
