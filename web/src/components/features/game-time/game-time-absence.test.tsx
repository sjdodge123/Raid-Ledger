import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { AbsenceForm, ABSENCE_INITIAL, type AbsenceState } from './game-time-absence';

/**
 * Absence form coverage (ROK-1426 mobile pass).
 *
 * AbsenceForm is pure props, so it renders without the CRUD hooks. The clock is
 * frozen to a known Thursday because the presets are relative to today.
 */
const THURSDAY = new Date(2026, 7, 27, 12, 0, 0); // 2026-08-27

function Harness({ onSubmit = vi.fn(), isPending = false }: { onSubmit?: () => void; isPending?: boolean }) {
    const [state, setState] = useState<AbsenceState>({ ...ABSENCE_INITIAL, show: true });
    return (
        <AbsenceForm
            state={state}
            onChange={(patch) => setState((s) => ({ ...s, ...patch }))}
            onSubmit={onSubmit}
            isPending={isPending}
        />
    );
}

const from = () => screen.getByLabelText('From') as HTMLInputElement;
const to = () => screen.getByLabelText('To') as HTMLInputElement;
const submit = () => screen.getByTestId('absence-submit');
const span = () => screen.getByTestId('absence-span');

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(THURSDAY); });
afterEach(() => { vi.useRealTimers(); });

describe('AbsenceForm — presets', () => {
    it('This weekend fills the coming Saturday to Sunday', () => {
        render(<Harness />);
        fireEvent.click(screen.getByTestId('absence-pick-weekend'));

        expect(from().value).toBe('2026-08-29');
        expect(to().value).toBe('2026-08-30');
        expect(span()).toHaveTextContent('2 days');
    });

    it('Next week fills the following Monday to Sunday', () => {
        render(<Harness />);
        fireEvent.click(screen.getByTestId('absence-pick-next-week'));

        expect(from().value).toBe('2026-08-31');
        expect(to().value).toBe('2026-09-06');
        expect(span()).toHaveTextContent('7 days');
    });

    it('marks the matching preset as pressed, and only that one', () => {
        render(<Harness />);
        fireEvent.click(screen.getByTestId('absence-pick-weekend'));

        expect(screen.getByTestId('absence-pick-weekend')).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByTestId('absence-pick-next-week')).toHaveAttribute('aria-pressed', 'false');
        expect(screen.getByTestId('absence-pick-custom')).toHaveAttribute('aria-pressed', 'false');
    });

    it('flips to Custom once a date is edited by hand', () => {
        render(<Harness />);
        fireEvent.click(screen.getByTestId('absence-pick-weekend'));
        fireEvent.change(to(), { target: { value: '2026-09-02' } });

        expect(screen.getByTestId('absence-pick-custom')).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByTestId('absence-pick-weekend')).toHaveAttribute('aria-pressed', 'false');
    });

    it('Custom clears both dates', () => {
        render(<Harness />);
        fireEvent.click(screen.getByTestId('absence-pick-next-week'));
        fireEvent.click(screen.getByTestId('absence-pick-custom'));

        expect(from().value).toBe('');
        expect(to().value).toBe('');
        expect(span()).toHaveTextContent('');
    });

    it('starts with no preset selected', () => {
        render(<Harness />);
        for (const id of ['weekend', 'next-week', 'custom']) {
            expect(screen.getByTestId(`absence-pick-${id}`)).toHaveAttribute('aria-pressed', 'false');
        }
    });
});

describe('AbsenceForm — validation', () => {
    it('cannot submit an empty form', () => {
        render(<Harness />);
        expect(submit()).toBeDisabled();
        expect(span()).toHaveTextContent('');
    });

    it('cannot submit with only a start date', () => {
        render(<Harness />);
        fireEvent.change(from(), { target: { value: '2026-08-29' } });
        expect(submit()).toBeDisabled();
    });

    it('enables submit for a valid range and reports the inclusive day count', () => {
        const onSubmit = vi.fn();
        render(<Harness onSubmit={onSubmit} />);
        fireEvent.change(from(), { target: { value: '2026-08-29' } });
        fireEvent.change(to(), { target: { value: '2026-08-31' } });

        expect(span()).toHaveTextContent('3 days');
        expect(submit()).toBeEnabled();
        fireEvent.click(submit());
        expect(onSubmit).toHaveBeenCalledTimes(1);
    });

    it('says "1 day" for a single-day absence', () => {
        render(<Harness />);
        fireEvent.change(from(), { target: { value: '2026-08-29' } });
        fireEvent.change(to(), { target: { value: '2026-08-29' } });
        expect(span()).toHaveTextContent('1 day');
        expect(submit()).toBeEnabled();
    });

    it('refuses an inverted range', () => {
        render(<Harness />);
        fireEvent.change(from(), { target: { value: '2026-08-31' } });
        fireEvent.change(to(), { target: { value: '2026-08-29' } });

        expect(span()).toHaveTextContent('');
        expect(submit()).toBeDisabled();
    });

    it('constrains the To picker to the chosen start, matching the API rule', () => {
        render(<Harness />);
        expect(to().min).toBe('');
        fireEvent.change(from(), { target: { value: '2026-08-29' } });
        expect(to().min).toBe('2026-08-29');
    });

    it('blocks submit while a save is in flight', () => {
        render(<Harness isPending />);
        fireEvent.click(screen.getByTestId('absence-pick-weekend'));
        expect(submit()).toBeDisabled();
        expect(submit()).toHaveTextContent('Saving...');
    });
});

describe('AbsenceForm — reason', () => {
    it('is optional and capped at the API limit', () => {
        render(<Harness />);
        const reason = screen.getByLabelText('Reason') as HTMLInputElement;
        expect(reason.maxLength).toBe(255);

        fireEvent.click(screen.getByTestId('absence-pick-weekend'));
        expect(submit()).toBeEnabled();

        fireEvent.change(reason, { target: { value: 'Vacation' } });
        expect(reason.value).toBe('Vacation');
    });
});
