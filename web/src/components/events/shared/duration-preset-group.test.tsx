/**
 * ROK-1649 B2 — DurationPresetGroup (segmented RadioGroup 'Duration') and the
 * DurationSection that uses it: radios by name, arrow keys move the checked
 * radio, Custom reveals named hr/min spinbuttons, errors are role=alert.
 */
import { useState, type JSX } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DurationPresetGroup, type DurationChoice } from './duration-preset-group';
import { DurationSection } from './duration-section';

const PRESETS = [
    { label: '30m', minutes: 30 },
    { label: '1h', minutes: 60 },
    { label: '2h', minutes: 120 },
] as const;

function GroupHarness({ initial = 60, error, spy }: {
    initial?: DurationChoice; error?: string; spy?: (v: DurationChoice) => void;
}): JSX.Element {
    const [value, setValue] = useState<DurationChoice>(initial);
    return (
        <DurationPresetGroup presets={PRESETS} value={value} error={error}
            onChange={(v) => { setValue(v); spy?.(v); }} />
    );
}

function SectionHarness({ durationError }: { durationError?: string }): JSX.Element {
    const [minutes, setMinutes] = useState(120);
    const [custom, setCustom] = useState(false);
    return (
        <>
            <DurationSection durationMinutes={minutes} customDuration={custom} durationError={durationError}
                onDurationMinutesChange={setMinutes} onCustomDurationChange={setCustom} />
            <output data-testid="minutes">{minutes}</output>
        </>
    );
}

describe('DurationPresetGroup', () => {
    it('is a radiogroup named Duration with one radio per preset plus Custom, no asterisk', () => {
        render(<GroupHarness />);
        const group = screen.getByRole('radiogroup', { name: 'Duration' });
        const names = screen.getAllByRole('radio').map((r) => r.getAttribute('value'));
        expect(names).toEqual(['30', '60', '120', 'custom']);
        expect(screen.getByRole('radio', { name: 'Custom' })).toBeInTheDocument();
        expect(screen.getByRole('radio', { name: '1h' })).toBeChecked();
        expect(group.textContent).not.toContain('*');
    });

    it('arrow keys move the checked radio and report minutes, then Custom', async () => {
        const spy = vi.fn();
        render(<GroupHarness initial={120} spy={spy} />);
        await userEvent.click(screen.getByRole('radio', { name: '2h' }));
        spy.mockClear();
        await userEvent.keyboard('{ArrowLeft}');
        expect(screen.getByRole('radio', { name: '1h' })).toBeChecked();
        expect(spy).toHaveBeenLastCalledWith(60);
        await userEvent.keyboard('{ArrowRight}{ArrowRight}');
        expect(screen.getByRole('radio', { name: 'Custom' })).toBeChecked();
        expect(spy).toHaveBeenLastCalledWith('custom');
    });

    it('checks Custom when value is custom', () => {
        render(<GroupHarness initial="custom" />);
        expect(screen.getByRole('radio', { name: 'Custom' })).toBeChecked();
        expect(screen.getByRole('radio', { name: '1h' })).not.toBeChecked();
    });

    it('shows the error as role=alert and marks the group invalid', () => {
        render(<GroupHarness error="Duration must be at least 15 minutes" />);
        expect(screen.getByRole('alert')).toHaveTextContent('Duration must be at least 15 minutes');
        expect(screen.getByRole('alert')).toHaveClass('text-danger');
        expect(screen.getByRole('radiogroup', { name: 'Duration' })).toHaveAttribute('aria-invalid', 'true');
    });
});

describe('DurationSection', () => {
    it('Custom reveals the hr/min spinbuttons by name, and they edit the minutes', async () => {
        render(<SectionHarness />);
        expect(screen.queryByRole('spinbutton', { name: 'Duration hours' })).not.toBeInTheDocument();
        await userEvent.click(screen.getByRole('radio', { name: 'Custom' }));
        const hours = screen.getByRole('spinbutton', { name: 'Duration hours' });
        const mins = screen.getByRole('spinbutton', { name: 'Duration minutes' });
        expect(hours).toHaveAttribute('inputmode', 'numeric');
        expect(mins).toHaveAttribute('inputmode', 'numeric');
        await userEvent.clear(mins);
        await userEvent.type(mins, '30');
        expect(screen.getByTestId('minutes')).toHaveTextContent('150');
    });

    it('a preset radio hides the custom fields again and sets the minutes', async () => {
        render(<SectionHarness />);
        await userEvent.click(screen.getByRole('radio', { name: 'Custom' }));
        await userEvent.click(screen.getByRole('radio', { name: '3h' }));
        expect(screen.queryByRole('spinbutton', { name: 'Duration hours' })).not.toBeInTheDocument();
        expect(screen.getByTestId('minutes')).toHaveTextContent('180');
    });

    it('renders durationError as role=alert on the Duration group', () => {
        render(<SectionHarness durationError="Pick a duration" />);
        expect(screen.getByRole('alert')).toHaveTextContent('Pick a duration');
        expect(screen.getByRole('radiogroup', { name: 'Duration' })).toHaveAttribute('aria-invalid', 'true');
    });
});
