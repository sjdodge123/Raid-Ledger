/**
 * ROK-1655 PR-1 — ColorInput (plan ruling 1; target site BrandingSection's
 * accent picker): a native colour well named "<label> colour picker" paired
 * with the shared mono Input holding the hex text. The hex field keeps a
 * draft: a valid #rrggbb is lowercased and reported; anything else is marked
 * invalid, never reported, and reverts to `value` on blur.
 */
import { useState, type JSX } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { ColorInput } from './color-input';
import { Field } from './field';

/** A parent that owns the value, as BrandingSection does. */
function Harness({ initial, spy }: { initial: string; spy: (hex: string) => void }): JSX.Element {
    const [value, setValue] = useState(initial);
    return <ColorInput label="Accent" value={value} onChange={(hex) => { spy(hex); setValue(hex); }} />;
}

const hexBox = (name = 'Accent'): HTMLInputElement => screen.getByRole('textbox', { name }) as HTMLInputElement;
const well = (): HTMLInputElement => screen.getByLabelText('Accent colour picker') as HTMLInputElement;

describe('ColorInput — hex draft', () => {
    it('typing a valid hex calls onChange once, with the lowercased value', async () => {
        const onChange = vi.fn();
        render(<ColorInput label="Accent" value="#10b981" onChange={onChange} />);
        await userEvent.clear(hexBox());
        await userEvent.type(hexBox(), '#AABBCC');
        expect(onChange, 'only the complete #rrggbb draft may be reported').toHaveBeenCalledTimes(1);
        expect(onChange).toHaveBeenCalledWith('#aabbcc');
    });

    it('an invalid hex sets aria-invalid, is never reported, and reverts to value on blur', async () => {
        const onChange = vi.fn();
        render(<ColorInput label="Accent" value="#10b981" onChange={onChange} />);
        await userEvent.clear(hexBox());
        await userEvent.type(hexBox(), '#12');
        expect(hexBox()).toHaveAttribute('aria-invalid', 'true');
        expect(onChange).not.toHaveBeenCalled();
        await userEvent.tab();
        expect(hexBox().value, 'blur must revert an invalid draft to value').toBe('#10b981');
        expect(hexBox()).not.toHaveAttribute('aria-invalid');
    });

    it('a new value prop replaces the hex text (preset swatch, Reset)', () => {
        const { rerender } = render(<ColorInput label="Accent" value="#10b981" onChange={vi.fn()} />);
        rerender(<ColorInput label="Accent" value="#3b82f6" onChange={vi.fn()} />);
        expect(hexBox().value).toBe('#3b82f6');
    });
});

describe('ColorInput — colour well', () => {
    it('is a native type=color well named "<label> colour picker", 44px square on the edge token', () => {
        render(<ColorInput label="Accent" value="#10b981" onChange={vi.fn()} />);
        expect(well()).toHaveAttribute('type', 'color');
        expect(well()).toHaveClass('h-11', 'w-11', 'rounded-lg', 'border-edge');
        expect(well().value).toBe('#10b981');
    });

    it('a well change calls onChange and the hex text follows', () => {
        const spy = vi.fn();
        render(<Harness initial="#10b981" spy={spy} />);
        fireEvent.change(well(), { target: { value: '#ff0000' } });
        expect(spy).toHaveBeenCalledWith('#ff0000');
        expect(hexBox().value, 'the hex text must follow the well').toBe('#ff0000');
    });
});

describe('ColorInput — Field wiring, states and a11y', () => {
    it('inside a Field, the Field label and hint name and describe the hex textbox', () => {
        render(
            <Field label="Accent colour" hint="Used for buttons">
                <ColorInput label="Accent colour" value="#10b981" onChange={vi.fn()} />
            </Field>,
        );
        const box = screen.getByLabelText('Accent colour');
        expect(box).toHaveAttribute('type', 'text');
        expect(box).toHaveClass('font-mono');
        expect(box).toHaveAccessibleDescription('Used for buttons');
        expect(screen.getByLabelText('Accent colour colour picker')).toHaveAttribute('type', 'color');
    });

    it('disabled disables both the well and the hex field', () => {
        render(<ColorInput label="Accent" value="#10b981" onChange={vi.fn()} disabled />);
        expect(well()).toBeDisabled();
        expect(hexBox()).toBeDisabled();
    });

    it('invalid marks the hex field aria-invalid', () => {
        render(<ColorInput label="Accent" value="#10b981" onChange={vi.fn()} invalid />);
        expect(hexBox()).toHaveAttribute('aria-invalid', 'true');
    });

    it('has no axe violations bare and inside a Field with an error', async () => {
        const { container } = render(
            <div>
                <ColorInput label="Accent" value="#10b981" onChange={vi.fn()} />
                <Field label="Brand colour" error="Pick a darker colour">
                    <ColorInput label="Brand colour" value="#ffffff" onChange={vi.fn()} />
                </Field>
            </div>,
        );
        expect(await axe(container)).toHaveNoViolations();
    });
});
