/**
 * ROK-1646 — RadioGroup (spike ROK-1644 §4.5): native radios in a labelled
 * radiogroup, list and segmented appearances, native arrow-key movement.
 */
import { useState, type JSX } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RadioGroup, type RadioGroupProps } from './radio-group';

const OPTIONS = [
    { value: '1h', label: '1 hour' },
    { value: '2h', label: '2 hours', description: 'A typical raid night.' },
    { value: '3h', label: '3 hours' },
];

function Harness(p: Partial<RadioGroupProps<string>> & { onSpy?: (v: string) => void }): JSX.Element {
    const [value, setValue] = useState('1h');
    return (
        <RadioGroup
            label="Duration" options={OPTIONS} value={value} {...p}
            onChange={(v) => { setValue(v); p.onSpy?.(v); }}
        />
    );
}

describe('RadioGroup — semantics', () => {
    it.each(['list', 'segmented'] as const)('%s: a radiogroup named by its label, one native radio per option', (appearance) => {
        render(<Harness appearance={appearance} />);
        const group = screen.getByRole('radiogroup', { name: 'Duration' });
        const radios = screen.getAllByRole('radio');
        expect(radios).toHaveLength(3);
        radios.forEach((r) => expect(group).toContainElement(r));
        expect(screen.getByRole('radio', { name: '1 hour' })).toBeChecked();
        expect(new Set(radios.map((r) => r.getAttribute('name'))).size).toBe(1);
    });

    it('list: each option is a 44px row with the description linked', () => {
        render(<Harness />);
        const radio = screen.getByRole('radio', { name: '2 hours' });
        expect(radio).toHaveClass('w-5', 'h-5', 'accent-success');
        expect(radio.closest('label')).toHaveClass('min-h-[44px]');
        expect(radio).toHaveAccessibleDescription('A typical raid night.');
    });

    it('segmented: radios are visually hidden, the segment shows ON with bg-overlay', () => {
        render(<Harness appearance="segmented" />);
        const radio = screen.getByRole('radio', { name: '2 hours' });
        expect(radio).toHaveClass('sr-only');
        const seg = radio.closest('label');
        expect(seg).toHaveClass('min-h-[44px]', 'text-muted', 'has-[:checked]:bg-overlay', 'has-[:checked]:text-foreground');
        expect(seg).toHaveClass('has-[:focus-visible]:ring-success/80');
    });
});

describe('RadioGroup — interaction', () => {
    it('clicking an option calls onChange with its value', async () => {
        const spy = vi.fn();
        render(<Harness onSpy={spy} />);
        await userEvent.click(screen.getByText('3 hours'));
        expect(spy).toHaveBeenCalledWith('3h');
        expect(screen.getByRole('radio', { name: '3 hours' })).toBeChecked();
    });

    it.each(['list', 'segmented'] as const)('%s: Tab lands on the checked radio and arrows move the selection', async (appearance) => {
        const spy = vi.fn();
        render(<Harness appearance={appearance} onSpy={spy} />);
        await userEvent.tab();
        expect(screen.getByRole('radio', { name: '1 hour' })).toHaveFocus();
        await userEvent.keyboard('{ArrowRight}');
        expect(spy).toHaveBeenLastCalledWith('2h');
        expect(screen.getByRole('radio', { name: '2 hours' })).toHaveFocus();
        await userEvent.keyboard('{ArrowUp}');
        expect(spy).toHaveBeenLastCalledWith('1h');
    });

    it('disabled disables every radio', () => {
        render(<Harness disabled />);
        screen.getAllByRole('radio').forEach((r) => expect(r).toBeDisabled());
    });

    it('hideLabel keeps the accessible name but hides the legend visually', () => {
        render(<Harness hideLabel />);
        expect(screen.getByRole('radiogroup', { name: 'Duration' })).toBeInTheDocument();
        expect(screen.getByText('Duration')).toHaveClass('sr-only');
    });
});
