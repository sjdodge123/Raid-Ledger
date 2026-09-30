/** StretchedAction (§4.2, TDB:1949) — the contract RosterSlot and the gallery card depend on. */
import { describe, it, expect, vi } from 'vitest';
import { createRef } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { StretchedAction, STRETCHED_ACTION_CLASS } from './stretched-action';

describe('StretchedAction', () => {
    it('is a native, empty type="button" named by `label`', () => {
        render(<StretchedAction label="Join tank slot 1" />);
        const action = screen.getByRole('button', { name: 'Join tank slot 1' });
        expect(action.tagName).toBe('BUTTON');
        expect(action).toHaveAttribute('type', 'button');
        expect(action, 'the action paints nothing of its own').toBeEmptyDOMElement();
    });

    it('stretches over the frame border with the shared focus ring and no fill', () => {
        render(<StretchedAction label="Manage" />);
        // Pinned as a literal: comparing the constant to itself would pass whatever it said.
        const expected = 'absolute -inset-px cursor-pointer rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-success/80 focus-visible:ring-offset-2 focus-visible:ring-offset-surface';
        expect(screen.getByRole('button')).toHaveAttribute('class', expected);
        expect(STRETCHED_ACTION_CLASS).toBe(expected);
        expect(STRETCHED_ACTION_CLASS, 'no visual fill — the card underneath is the look').not.toMatch(/\bbg-/);
    });

    it('stands its focus ring off the frame so a frame ring (the current-user glow) cannot hide it', () => {
        render(<StretchedAction label="Manage" />);
        const classes = screen.getByRole('button').className.split(' ');
        expect(classes, 'a flush ring at -inset-px lands exactly on the frame ring-2').toEqual(
            expect.arrayContaining(['focus-visible:ring-offset-2', 'focus-visible:ring-offset-surface']),
        );
    });

    it('keeps `label` as the only accessible name', () => {
        // TS never excess-checks hyphenated JSX attributes, so the props Omit cannot stop these
        // at compile time; the render order (fixed attributes after the spread) has to.
        render(<><span id="other">Other</span><StretchedAction label="Join" aria-label="Other" /></>);
        expect(screen.getByRole('button').getAttribute('aria-label'), 'a passed aria-label overrode label').toBe('Join');
        render(<StretchedAction label="Assign" aria-labelledby="other" />);
        expect(screen.getAllByRole('button')[1], 'a passed aria-labelledby replaced label').toHaveAccessibleName('Assign');
    });

    it('fires onClick and never submits a surrounding form', () => {
        const onClick = vi.fn();
        const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
        render(<form onSubmit={onSubmit}><StretchedAction label="Open" onClick={onClick} /></form>);
        fireEvent.click(screen.getByRole('button', { name: 'Open' }));
        expect(onClick).toHaveBeenCalledTimes(1);
        expect(onSubmit, 'a card action inside a form must not submit it').not.toHaveBeenCalled();
    });

    it('forwards its ref to the native button', () => {
        const ref = createRef<HTMLButtonElement>();
        render(<StretchedAction ref={ref} label="Focus me" />);
        expect(ref.current).toBe(screen.getByRole('button', { name: 'Focus me' }));
    });
});
