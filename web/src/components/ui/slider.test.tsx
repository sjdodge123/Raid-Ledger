/**
 * ROK-1646 — Slider (spike ROK-1644 §4.8, promotes SLIDER_CLS): a native
 * range input with a label, a font-mono value readout and a 44px track.
 */
import { createRef, useState, type JSX } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Slider } from './slider';

describe('Slider', () => {
    it('is a labelled native range on the success accent with a 44px track', () => {
        render(<Slider label="Min owners" value={3} min={0} max={15} onChange={() => undefined} />);
        const range = screen.getByRole('slider', { name: 'Min owners' });
        expect(range).toHaveAttribute('type', 'range');
        expect(range).toHaveAttribute('min', '0');
        expect(range).toHaveAttribute('max', '15');
        expect(range).toHaveValue('3');
        expect(range).toHaveClass('h-11', 'accent-success', 'focus-visible:ring-success/80');
    });

    it('shows the value in a font-mono readout tied to the input', () => {
        render(<Slider label="Min owners" value={7} onChange={() => undefined} />);
        const out = screen.getByTestId('slider-value');
        expect(out.tagName).toBe('OUTPUT');
        expect(out).toHaveTextContent('7');
        expect(out).toHaveClass('font-mono');
        expect(out).toHaveAttribute('for', screen.getByRole('slider', { name: 'Min owners' }).id);
    });

    it('formatValue drives the readout and aria-valuetext', () => {
        render(<Slider label="Threshold" value={40} onChange={() => undefined} formatValue={(v) => `${v}%`} />);
        expect(screen.getByTestId('slider-value')).toHaveTextContent('40%');
        expect(screen.getByRole('slider', { name: 'Threshold' })).toHaveAttribute('aria-valuetext', '40%');
    });

    it('onChange receives a number and the readout follows', () => {
        const spy = vi.fn();
        function Controlled(): JSX.Element {
            const [v, setV] = useState(2);
            return <Slider label="Players" value={v} min={0} max={10} onChange={(n) => { setV(n); spy(n); }} />;
        }
        render(<Controlled />);
        fireEvent.change(screen.getByRole('slider', { name: 'Players' }), { target: { value: '6' } });
        expect(spy).toHaveBeenCalledWith(6);
        expect(screen.getByTestId('slider-value')).toHaveTextContent('6');
    });

    it('hideLabel keeps the name; showValue=false drops the readout', () => {
        render(<Slider label="Volume" hideLabel showValue={false} value={1} onChange={() => undefined} />);
        expect(screen.getByRole('slider', { name: 'Volume' })).toBeInTheDocument();
        expect(screen.getByText('Volume')).toHaveClass('sr-only');
        expect(screen.queryByTestId('slider-value')).not.toBeInTheDocument();
    });

    it('disabled uses the single opacity treatment', () => {
        render(<Slider label="Locked" value={1} disabled onChange={() => undefined} />);
        const range = screen.getByRole('slider', { name: 'Locked' });
        expect(range).toBeDisabled();
        expect(range).toHaveClass('disabled:opacity-50');
    });
});

describe('Slider — review fixes', () => {
    it('is appearance-none so the 20px thumb sizing applies, with a painted track and fill', () => {
        render(<Slider label="Owners" value={5} min={0} max={10} onChange={() => undefined} />);
        const range = screen.getByRole('slider', { name: 'Owners' });
        expect(range, 'without appearance-none webkit ignores the thumb size').toHaveClass('appearance-none', '[&::-webkit-slider-thumb]:appearance-none');
        expect(range.style.getPropertyValue('--slider-fill')).toBe('50%');
    });

    it('the readout is not a live region (aria-valuetext already speaks the value)', () => {
        render(<Slider label="Owners" value={5} onChange={() => undefined} />);
        expect(screen.getByTestId('slider-value'), '<output> is implicitly live and double-announces').toHaveAttribute('aria-live', 'off');
    });

    it('forwards its ref to the range input', () => {
        const ref = createRef<HTMLInputElement>();
        render(<Slider ref={ref} label="Owners" value={5} onChange={() => undefined} />);
        expect(ref.current).toBe(screen.getByRole('slider', { name: 'Owners' }));
    });
});
