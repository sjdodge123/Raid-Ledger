/**
 * ROK-1646 — RadioGroup (spike ROK-1644 §4.5): native radios in a labelled
 * radiogroup, list and segmented appearances, native arrow-key movement.
 */
import { createRef, useState, type JSX } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RadioGroup, type RadioGroupProps } from './radio-group';
import { Field } from './field';

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

    // ROK-1688: bg-overlay alone on the bg-panel track is 1.13:1 in default-light,
    // so ON also paints a full-strength `success` border (>= 4.06:1 on bg-panel in
    // every theme, WCAG 1.4.11). OFF keeps a transparent border so nothing shifts.
    it('segmented: radios are visually hidden, the segment shows ON with bg-overlay + a success border', () => {
        render(<Harness appearance="segmented" />);
        const radio = screen.getByRole('radio', { name: '2 hours' });
        expect(radio).toHaveClass('sr-only');
        const seg = radio.closest('label');
        expect(seg).toHaveClass('min-h-[44px]', 'text-muted', 'border', 'border-transparent');
        expect(seg).toHaveClass('has-[:checked]:bg-overlay', 'has-[:checked]:border-success', 'has-[:checked]:text-foreground');
        expect(seg?.className).not.toMatch(/has-\[:checked\]:border-success\//);
        expect(seg).toHaveClass('has-[:focus-visible]:ring-success/80', 'has-[:focus-visible]:ring-offset-2', 'has-[:focus-visible]:ring-offset-panel');
    });

    // ROK-1649 review: six duration segments (~327px of labels + padding) are
    // wider than the 293px create-event card at 375px. A nowrap track pushed
    // the fieldset's min-content out through the card; the track must wrap.
    it('segmented: the track wraps, so a set wider than its container flows onto a second row', () => {
        render(<Harness appearance="segmented" />);
        const track = screen.getByRole('radio', { name: '2 hours' }).closest('label')?.parentElement;
        expect(track).toHaveClass('flex', 'flex-wrap');
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

describe('RadioGroup — segmented keyboard', () => {
    it('ArrowDown / ArrowLeft move and select, and the ON segment follows the checked radio', async () => {
        const spy = vi.fn();
        render(<Harness appearance="segmented" onSpy={spy} />);
        await userEvent.tab();
        await userEvent.keyboard('{ArrowDown}');
        expect(spy).toHaveBeenLastCalledWith('2h');
        expect(screen.getByRole('radio', { name: '2 hours' })).toBeChecked();
        await userEvent.keyboard('{ArrowDown}{ArrowLeft}');
        expect(spy.mock.calls.map((c) => c[0])).toEqual(['2h', '3h', '2h']);
        expect(screen.getByRole('radio', { name: '2 hours' })).toHaveFocus();
    });
});

describe('RadioGroup — validation wiring and ref', () => {
    it('error renders an inline alert, marks the group invalid and describes it', () => {
        render(<Harness error="Pick a duration." />);
        const group = screen.getByRole('radiogroup', { name: 'Duration' });
        expect(screen.getByRole('alert')).toHaveTextContent('Pick a duration.');
        expect(group, 'error did not mark the radiogroup invalid').toHaveAttribute('aria-invalid', 'true');
        expect(group).toHaveAccessibleDescription('Pick a duration.');
    });

    it('invalid and aria-describedby pass through; a surrounding Field adds its wiring', () => {
        render(<><p id="ext">Shown on the event.</p>
            <Field label="Wrapper" hint="Pick one." error="Required."><Harness aria-describedby="ext" /></Field></>);
        const group = screen.getByRole('radiogroup', { name: 'Duration' });
        expect(group, 'the Field error did not reach the radiogroup').toHaveAttribute('aria-invalid', 'true');
        expect(group).toHaveAccessibleDescription('Shown on the event. Pick one. Required.');
    });

    it('forwards its ref to the fieldset', () => {
        const ref = createRef<HTMLFieldSetElement>();
        render(<RadioGroup ref={ref} label="Duration" options={OPTIONS} value="1h" onChange={() => undefined} />);
        expect(ref.current).toBe(screen.getByRole('radiogroup', { name: 'Duration' }));
    });
});
