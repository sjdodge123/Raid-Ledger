import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Switch } from './switch';

function renderSwitch(props: { checked?: boolean; disabled?: boolean } = {}) {
    const onChange = vi.fn();
    render(<Switch label="Enable thing" checked={props.checked ?? false}
        disabled={props.disabled} onChange={onChange} />);
    return { onChange, control: screen.getByRole('switch', { name: 'Enable thing' }) };
}

describe('Switch', () => {
    it('exposes role="switch" with aria-checked reflecting the state', () => {
        const { control } = renderSwitch({ checked: true });
        expect(control).toHaveAttribute('aria-checked', 'true');
        expect(control).toBeChecked();
    });

    it('reports the NEW state when clicked', async () => {
        const { control, onChange } = renderSwitch({ checked: false });
        await userEvent.click(control);
        expect(onChange).toHaveBeenCalledWith(true);
    });

    it('toggles from the keyboard with Space and Enter', async () => {
        const { control, onChange } = renderSwitch({ checked: true });
        control.focus();
        await userEvent.keyboard(' ');
        await userEvent.keyboard('{Enter}');
        expect(onChange.mock.calls).toEqual([[false], [false]]);
    });

    it('is disabled: not pressable and styled as disabled', async () => {
        const { control, onChange } = renderSwitch({ disabled: true });
        expect(control).toBeDisabled();
        expect(control.className).toContain('disabled:opacity-50');
        await userEvent.click(control);
        expect(onChange).not.toHaveBeenCalled();
    });

    it('shows a visible focus ring and uses tokens, never raw colours', () => {
        const { control } = renderSwitch();
        expect(control.className).toContain('focus-visible:ring-2');
        expect(control.outerHTML).not.toMatch(/(?:bg|text|ring|border)-(?:slate|gray|zinc|emerald|green)|#[0-9a-f]{3,6}\b/i);
    });
});
