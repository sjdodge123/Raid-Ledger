/**
 * SlotStepper (ROK-1649): the +/- controls are named `Increase <label>` /
 * `Decrease <label>` icon-only Buttons, natively disabled at the bounds, and
 * the value is a spinbutton named `<label> slots`.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SlotStepper } from './slot-stepper';

function renderStepper(value: number, opts: { min?: number; max?: number } = {}) {
    const onChange = vi.fn();
    render(<SlotStepper label="Tank" value={value} onChange={onChange} color="bg-blue-500" {...opts} />);
    return { onChange };
}

describe('SlotStepper — accessible names', () => {
    it('names the buttons after the label and the value after "<label> slots"', () => {
        renderStepper(2);
        expect(screen.getByRole('button', { name: 'Increase Tank' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Decrease Tank' })).toBeInTheDocument();
        expect(screen.getByRole('spinbutton', { name: 'Tank slots' })).toHaveValue(2);
    });
});

describe('SlotStepper — bounds are native disabled', () => {
    it('disables Decrease (natively) at min and leaves Increase enabled', () => {
        renderStepper(0);
        expect(screen.getByRole('button', { name: 'Decrease Tank' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Increase Tank' })).toBeEnabled();
    });

    it('disables Increase (natively) at a custom max and leaves Decrease enabled', () => {
        renderStepper(5, { max: 5 });
        expect(screen.getByRole('button', { name: 'Increase Tank' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Decrease Tank' })).toBeEnabled();
    });

    it('respects a custom min', () => {
        renderStepper(1, { min: 1 });
        expect(screen.getByRole('button', { name: 'Decrease Tank' })).toBeDisabled();
    });
});

describe('SlotStepper — onChange values', () => {
    it('Increase calls onChange with value + 1', () => {
        const { onChange } = renderStepper(2);
        fireEvent.click(screen.getByRole('button', { name: 'Increase Tank' }));
        expect(onChange).toHaveBeenLastCalledWith(3);
    });

    it('Decrease calls onChange with value - 1', () => {
        const { onChange } = renderStepper(2);
        fireEvent.click(screen.getByRole('button', { name: 'Decrease Tank' }));
        expect(onChange).toHaveBeenLastCalledWith(1);
    });

    it('a disabled Decrease at min never calls onChange', () => {
        const { onChange } = renderStepper(0);
        fireEvent.click(screen.getByRole('button', { name: 'Decrease Tank' }));
        expect(onChange).not.toHaveBeenCalled();
    });

    it('typing a number calls onChange with it, clamped to max', () => {
        const { onChange } = renderStepper(2, { max: 10 });
        const input = screen.getByRole('spinbutton', { name: 'Tank slots' });
        fireEvent.change(input, { target: { value: '7' } });
        expect(onChange).toHaveBeenLastCalledWith(7);
        fireEvent.change(input, { target: { value: '42' } });
        expect(onChange).toHaveBeenLastCalledWith(10);
    });

    it('clearing the field does not call onChange', () => {
        const { onChange } = renderStepper(2);
        fireEvent.change(screen.getByRole('spinbutton', { name: 'Tank slots' }), { target: { value: '' } });
        expect(onChange).not.toHaveBeenCalled();
    });
});
