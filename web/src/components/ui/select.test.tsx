/**
 * ROK-1646 — Select (spike ROK-1644 §4.4): a native <select> on the shared
 * field frame, fieldSize, placeholder option, chevron, invalid, forwarded ref
 * and the Field context wiring.
 */
import { createRef } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Select } from './select';
import { Field } from './field';

const opts = (
    <>
        <option value="na">North America</option>
        <option value="eu">Europe</option>
    </>
);

describe('Select — frame', () => {
    it('is a native select on the token frame with room for the chevron', () => {
        render(<Select aria-label="Region">{opts}</Select>);
        expect(screen.getByRole('combobox', { name: 'Region' })).toHaveClass(
            'min-h-[44px]', 'text-base', 'lg:text-sm', 'bg-panel', 'border-edge', 'rounded-lg',
            'focus-visible:ring-success/80', 'appearance-none', 'pr-9', 'px-3',
        );
    });

    it('renders a decorative chevron', () => {
        render(<Select aria-label="Region">{opts}</Select>);
        expect(screen.getByTestId('select-chevron')).toHaveAttribute('aria-hidden', 'true');
    });

    it('fieldSize lg swaps the padding and never sets the native size attribute', () => {
        render(<Select aria-label="Region" fieldSize="lg">{opts}</Select>);
        const select = screen.getByRole('combobox', { name: 'Region' });
        expect(select).toHaveClass('px-4', 'py-3');
        expect(select).not.toHaveAttribute('size');
    });

    it('placeholder renders an empty-value first option', () => {
        render(<Select aria-label="Region" placeholder="Pick a region" defaultValue="">{opts}</Select>);
        const first = screen.getAllByRole('option')[0];
        expect(first).toHaveTextContent('Pick a region');
        expect(first).toHaveValue('');
        expect(screen.getByRole('combobox', { name: 'Region' })).toHaveValue('');
    });

    it('invalid sets aria-invalid', () => {
        render(<Select aria-label="Region" invalid>{opts}</Select>);
        expect(screen.getByRole('combobox', { name: 'Region' })).toHaveAttribute('aria-invalid', 'true');
    });
});

describe('Select — behaviour and wiring', () => {
    it('passes value/onChange through and forwards the ref', async () => {
        const onChange = vi.fn();
        const ref = createRef<HTMLSelectElement>();
        render(<Select aria-label="Region" ref={ref} onChange={onChange}>{opts}</Select>);
        const select = screen.getByRole('combobox', { name: 'Region' });
        await userEvent.selectOptions(select, 'eu');
        expect(onChange).toHaveBeenCalledTimes(1);
        expect(ref.current).toBe(select);
    });

    it('inside a Field it is labelled, described by the error and required', () => {
        render(<Field label="Region" error="Pick one" required><Select>{opts}</Select></Field>);
        const select = screen.getByRole('combobox', { name: 'Region' });
        expect(select).toHaveAttribute('aria-invalid', 'true');
        expect(select).toHaveAttribute('aria-required', 'true');
        expect(select).toHaveAccessibleDescription('Pick one');
    });
});
