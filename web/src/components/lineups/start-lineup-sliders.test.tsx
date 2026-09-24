/**
 * ROK-1650 — the start-lineup ranges are the shared `Slider` (named by their
 * visible label, formatted readout doubling as aria-valuetext) while the
 * testids + name/min/max/step the smoke specs read stay on the range input.
 */
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import {
    DurationSlider,
    ThresholdSlider,
    VotesPerPlayerSlider,
} from './start-lineup-sliders';

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
