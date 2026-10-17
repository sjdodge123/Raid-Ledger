/**
 * ROK-1650 — the start-lineup ranges are the shared `Slider` (named by their
 * visible label, formatted readout doubling as aria-valuetext) while the
 * testids + name/min/max/step the smoke specs read stay on the range input.
 */
import { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from '../../lib/toast';
import {
    DescriptionField,
    DurationSlider,
    ThresholdSlider,
    TiebreakerPicker,
    TitleField,
    VotesPerPlayerSlider,
} from './start-lineup-sliders';

vi.mock('../../lib/toast', () => ({
    toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

function renderDuration(value: number, onChange = vi.fn()) {
    render(
        <DurationSlider
            label="Building Phase"
            name="buildingDurationHours"
            testId="building-duration"
            value={value}
            onChange={onChange}
        />,
    );
    return onChange;
}

describe('DurationSlider', () => {
    it('is a slider named by its label, with testid/name/min/max/step on the range input', () => {
        renderDuration(5);
        const slider = screen.getByRole('slider', { name: 'Building Phase' });
        expect(slider).toHaveAttribute('data-testid', 'building-duration');
        expect(slider).toHaveAttribute('name', 'buildingDurationHours');
        expect(slider).toHaveAttribute('min', '1');
        expect(slider).toHaveAttribute('max', '168');
        expect(slider).toHaveAttribute('step', '1');
        expect(slider).toHaveValue('5');
        expect(slider).toHaveAttribute('aria-valuetext', '5 hours');
    });

    it('reads the TRUE value while the track is clamped below its floor', () => {
        renderDuration(0.25);
        const slider = screen.getByRole('slider', { name: 'Building Phase' });
        expect(slider).toHaveValue('1');
        expect(slider).toHaveAttribute('aria-valuetext', '15 min');
        expect(screen.getByTestId('slider-value')).toHaveTextContent('15 min');
    });

    it('reads the TRUE value while the track is clamped at its 7-day ceiling', () => {
        renderDuration(720);
        const slider = screen.getByRole('slider', { name: 'Building Phase' });
        expect(slider).toHaveValue('168');
        expect(slider).toHaveAttribute('aria-valuetext', '30 days');
    });

    it('reports a drag as a number of hours', () => {
        const onChange = renderDuration(5);
        fireEvent.change(screen.getByRole('slider', { name: 'Building Phase' }), {
            target: { value: '12' },
        });
        expect(onChange).toHaveBeenCalledWith(12);
    });

    it('keeps the exact-entry hours field named and testid-addressable', () => {
        renderDuration(5);
        const field = screen.getByRole('spinbutton', {
            name: 'Building Phase duration in hours',
        });
        expect(field).toHaveAttribute('data-testid', 'building-duration-hours');
        expect(field).toHaveValue(5);
    });
});

describe('VotesPerPlayerSlider', () => {
    it('is a slider named "Votes per Player" with the smoke attributes on the input', () => {
        render(<VotesPerPlayerSlider value={3} onChange={vi.fn()} />);
        const slider = screen.getByRole('slider', { name: 'Votes per Player' });
        expect(slider).toHaveAttribute('data-testid', 'votes-per-player');
        expect(slider).toHaveAttribute('min', '1');
        expect(slider).toHaveAttribute('max', '10');
        expect(slider).toHaveAttribute('step', '1');
        expect(slider).toHaveValue('3');
    });
});

describe('ThresholdSlider', () => {
    it('is a slider named "Match Threshold" reading a percentage', () => {
        render(<ThresholdSlider value={40} onChange={vi.fn()} />);
        const slider = screen.getByRole('slider', { name: 'Match Threshold' });
        expect(slider).toHaveAttribute('data-testid', 'match-threshold');
        expect(slider).toHaveAttribute('min', '0');
        expect(slider).toHaveAttribute('max', '100');
        expect(slider).toHaveAttribute('step', '5');
        expect(slider).toHaveAttribute('aria-valuetext', '40%');
        expect(screen.getByText('More matches')).toBeInTheDocument();
        expect(screen.getByText('Fewer, larger matches')).toBeInTheDocument();
    });

    it('reports a drag as a number', () => {
        const onChange = vi.fn();
        render(<ThresholdSlider value={40} onChange={onChange} />);
        fireEvent.change(screen.getByRole('slider', { name: 'Match Threshold' }), {
            target: { value: '55' },
        });
        expect(onChange).toHaveBeenCalledWith(55);
    });
});

function TitleHarness({ initial }: { initial: string }) {
    const [value, setValue] = useState(initial);
    return <TitleField value={value} onChange={setValue} />;
}

describe('TitleField (ruling 8: required inline, on blur)', () => {
    it('is the labelled, required, 100-char "Title" input with id lineup-title', () => {
        render(<TitleHarness initial="Lineup" />);
        const input = screen.getByRole('textbox', { name: /title/i });
        expect(input).toHaveAttribute('id', 'lineup-title');
        expect(input).toHaveAttribute('maxLength', '100');
        expect(input).toBeRequired();
        expect(document.querySelector('[class*="rose-"]')).toBeNull();
    });

    it('blurring an empty title shows an inline "Title is required" alert, not a toast', async () => {
        const user = userEvent.setup();
        render(<TitleHarness initial="Lineup" />);
        const input = screen.getByRole('textbox', { name: /title/i });
        await user.clear(input);
        expect(screen.queryByRole('alert')).toBeNull();
        await user.tab();
        const alert = screen.getByRole('alert');
        expect(alert).toHaveTextContent('Title is required');
        expect(input).toHaveAttribute('aria-invalid', 'true');
        expect(input.getAttribute('aria-describedby')).toContain(alert.id);
        expect(toast.error).not.toHaveBeenCalled();
    });

    it('clears the alert once the title is filled in again', async () => {
        const user = userEvent.setup();
        render(<TitleHarness initial="" />);
        const input = screen.getByRole('textbox', { name: /title/i });
        await user.click(input);
        await user.tab();
        expect(screen.getByRole('alert')).toHaveTextContent('Title is required');
        await user.type(input, 'Co-op Night');
        expect(screen.queryByRole('alert')).toBeNull();
        expect(input).not.toHaveAttribute('aria-invalid', 'true');
    });
});

describe('DescriptionField', () => {
    it('is the labelled Description textarea with an n/500 counter', () => {
        render(<DescriptionField value="Hello" onChange={vi.fn()} />);
        const box = screen.getByRole('textbox', { name: 'Description' });
        expect(box).toHaveAttribute('id', 'lineup-description');
        expect(box).toHaveAttribute('maxLength', '500');
        expect(screen.getByTestId('textarea-count')).toHaveTextContent('5/500');
        expect(screen.getAllByText(/\/\s*500/)).toHaveLength(1);
    });
});

type Tiebreaker = 'bracket' | 'veto' | null;

function TiebreakerHarness({ initial, spy }: { initial: Tiebreaker; spy: (v: Tiebreaker) => void }) {
    const [value, setValue] = useState<Tiebreaker>(initial);
    return <TiebreakerPicker value={value} onChange={(v) => { spy(v); setValue(v); }} />;
}

describe('TiebreakerPicker (ruling 6: segmented RadioGroup)', () => {
    it('is a radiogroup of Bracket / Veto / None, with null shown as None', () => {
        render(<TiebreakerHarness initial={null} spy={vi.fn()} />);
        const group = screen.getByRole('radiogroup', { name: 'Tiebreaker Mode' });
        expect(group).toHaveAccessibleDescription('Used when voting produces tied games at deadline.');
        expect(screen.getAllByRole('radio').map((r) => r.getAttribute('value'))).toEqual(['bracket', 'veto', 'none']);
        expect(screen.getByRole('radio', { name: 'None' })).toBeChecked();
        expect(document.querySelector('[class*="emerald"]')).toBeNull();
    });

    it('arrow keys move the selection and choosing None emits null', async () => {
        const user = userEvent.setup();
        const spy = vi.fn();
        render(<TiebreakerHarness initial="bracket" spy={spy} />);
        await user.tab();
        expect(screen.getByRole('radio', { name: 'Bracket' })).toHaveFocus();
        await user.keyboard('{ArrowRight}');
        expect(spy).toHaveBeenLastCalledWith('veto');
        expect(screen.getByRole('radio', { name: 'Veto' })).toBeChecked();
        await user.keyboard('{ArrowRight}');
        expect(spy).toHaveBeenLastCalledWith(null);
        expect(screen.getByRole('radio', { name: 'None' })).toBeChecked();
    });

    it('clicking Bracket from None emits bracket', async () => {
        const user = userEvent.setup();
        const spy = vi.fn();
        render(<TiebreakerHarness initial={null} spy={spy} />);
        await user.click(screen.getByRole('radio', { name: 'Bracket' }));
        expect(spy).toHaveBeenLastCalledWith('bracket');
    });
});
