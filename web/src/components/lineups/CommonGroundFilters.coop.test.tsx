/**
 * Tests for the co-op group-size filter on CommonGroundFilters (ROK-1400).
 *
 * Written TDD-style BEFORE the control exists — every test here must FAIL
 * on first run. The dev agent builds to make them pass.
 *
 * Prescribed contract:
 *  - `CommonGroundParams.minOnlineCoop?: number` (wired to the API param).
 *  - A checkbox with accessible name /co-op for our group size/i.
 *  - A range slider with accessible name /co-op group size/i, rendered
 *    only while the toggle is on (operator review 2026-08-20 — matches the
 *    Min owners / Players sliders rather than a number box).
 *  - Hint copy `showing games with co-op data` while the toggle is on.
 *  - Toggling ON seeds `minOnlineCoop` from `participantCount` (min 1);
 *    toggling OFF clears it to `undefined`.
 *  - The co-op filter is OPT-IN: it never activates itself on mount.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CommonGroundParams } from '../../lib/api-client';
import { CommonGroundFilters } from './CommonGroundFilters';

// `maxPlayers` is pre-set on the base filters so the unrelated ROK-1255
// auto-seed effect stays quiet and every onChange we assert on is ours.
const baseFilters: CommonGroundParams = {
    minOwners: 2,
    genre: undefined,
    maxPlayers: 4,
};

function renderFilters(
    overrides: Partial<CommonGroundParams> = {},
    props: { onChange?: ReturnType<typeof vi.fn>; participantCount?: number } = {},
) {
    const onChange = props.onChange ?? vi.fn();
    const result = render(
        <CommonGroundFilters
            filters={{ ...baseFilters, ...overrides }}
            onChange={onChange}
            search=""
            onSearchChange={vi.fn()}
            participantCount={props.participantCount}
        />,
    );
    return { onChange, ...result };
}

describe('CommonGroundFilters — co-op toggle rendering (ROK-1400)', () => {
    it('renders the co-op group-size toggle', () => {
        renderFilters();
        expect(
            screen.getByRole('checkbox', { name: /co-op for our group size/i }),
        ).toBeInTheDocument();
    });

    it('is unchecked when minOnlineCoop is undefined', () => {
        renderFilters({ minOnlineCoop: undefined });
        expect(
            screen.getByRole('checkbox', { name: /co-op for our group size/i }),
        ).not.toBeChecked();
    });

    it('is checked when minOnlineCoop is set', () => {
        renderFilters({ minOnlineCoop: 4 });
        expect(
            screen.getByRole('checkbox', { name: /co-op for our group size/i }),
        ).toBeChecked();
    });

    it('does NOT render the group-size control while the toggle is off', () => {
        renderFilters({ minOnlineCoop: undefined });
        expect(
            screen.queryByRole('slider', { name: /co-op group size/i }),
        ).not.toBeInTheDocument();
    });

    it('renders the group-size control with the active value while the toggle is on', () => {
        renderFilters({ minOnlineCoop: 5 });
        // Range inputs report their value as a string, matching the assertion
        // style of the sibling Min owners / Players slider tests.
        expect(
            screen.getByRole('slider', { name: /co-op group size/i }),
        ).toHaveValue('5');
    });
});

describe('CommonGroundFilters — co-op NULL-data hint (ROK-1400)', () => {
    it('shows the "showing games with co-op data" hint while the filter is active', () => {
        renderFilters({ minOnlineCoop: 4 });
        expect(
            screen.getByText(/showing games with co-op data/i),
        ).toBeInTheDocument();
    });

    it('hides the hint while the filter is inactive', () => {
        renderFilters({ minOnlineCoop: undefined });
        expect(
            screen.queryByText(/showing games with co-op data/i),
        ).not.toBeInTheDocument();
    });
});

describe('CommonGroundFilters — co-op auto-seed from participantCount (ROK-1400)', () => {
    it('seeds minOnlineCoop from participantCount when the toggle is switched on', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        renderFilters({ minOnlineCoop: undefined }, { onChange, participantCount: 3 });

        await user.click(
            screen.getByRole('checkbox', { name: /co-op for our group size/i }),
        );

        expect(onChange).toHaveBeenCalledWith(
            expect.objectContaining({ minOnlineCoop: 3 }),
        );
    });

    it('seeds to 1 when participantCount is unknown', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        renderFilters({ minOnlineCoop: undefined }, { onChange });

        await user.click(
            screen.getByRole('checkbox', { name: /co-op for our group size/i }),
        );

        expect(onChange).toHaveBeenCalledWith(
            expect.objectContaining({ minOnlineCoop: 1 }),
        );
    });

    it('seeds to 1 when participantCount is 0', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        renderFilters({ minOnlineCoop: undefined }, { onChange, participantCount: 0 });

        await user.click(
            screen.getByRole('checkbox', { name: /co-op for our group size/i }),
        );

        expect(onChange).toHaveBeenCalledWith(
            expect.objectContaining({ minOnlineCoop: 1 }),
        );
    });

    it('does NOT activate the co-op filter on mount (opt-in only)', () => {
        const onChange = vi.fn();
        renderFilters({ minOnlineCoop: undefined }, { onChange, participantCount: 4 });

        const coopCalls = onChange.mock.calls.filter(
            ([next]) => (next as CommonGroundParams).minOnlineCoop != null,
        );
        expect(coopCalls).toHaveLength(0);
        expect(
            screen.getByRole('checkbox', { name: /co-op for our group size/i }),
        ).not.toBeChecked();
    });
});

describe('CommonGroundFilters — co-op clearable (ROK-1400)', () => {
    it('clears minOnlineCoop to undefined when the toggle is switched off', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        renderFilters({ minOnlineCoop: 4 }, { onChange, participantCount: 4 });

        await user.click(
            screen.getByRole('checkbox', { name: /co-op for our group size/i }),
        );

        expect(onChange).toHaveBeenCalledWith(
            expect.objectContaining({ minOnlineCoop: undefined }),
        );
    });

    it('preserves the other filters when the co-op toggle is cleared', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        renderFilters({ minOnlineCoop: 4 }, { onChange, participantCount: 4 });

        await user.click(
            screen.getByRole('checkbox', { name: /co-op for our group size/i }),
        );

        expect(onChange).toHaveBeenCalledWith(
            expect.objectContaining({ minOwners: 2, maxPlayers: 4 }),
        );
    });
});

// ROK-1400: restored filters are a deliberate prior choice. Without the
// suppression the ROK-1255 one-shot seed re-pins `maxPlayers` on every
// remount and silently undoes a "Players: Any" the user chose last visit.
describe('CommonGroundFilters — suppressAutoSeed (ROK-1400)', () => {
    it('still auto-seeds maxPlayers on a first visit', () => {
        const onChange = vi.fn();
        renderFilters(
            { maxPlayers: undefined },
            { onChange, participantCount: 4 },
        );

        expect(onChange).toHaveBeenCalledWith(
            expect.objectContaining({ maxPlayers: 4 }),
        );
    });

    it('does NOT auto-seed maxPlayers when the filters were restored', () => {
        const onChange = vi.fn();
        render(
            <CommonGroundFilters
                filters={{ ...baseFilters, maxPlayers: undefined }}
                onChange={onChange}
                search=""
                onSearchChange={vi.fn()}
                participantCount={4}
                suppressAutoSeed
            />,
        );

        expect(onChange).not.toHaveBeenCalled();
    });
});

describe('CommonGroundFilters — co-op manual adjustment (ROK-1400)', () => {
    it('emits the adjusted value when the group-size slider changes', () => {
        const onChange = vi.fn();
        renderFilters({ minOnlineCoop: 4 }, { onChange, participantCount: 4 });

        const slider = screen.getByRole('slider', { name: /co-op group size/i });
        // Range inputs require the native value setter + a change event —
        // same mechanism the sibling Min owners slider test uses.
        const nativeSetter = Object.getOwnPropertyDescriptor(
            HTMLInputElement.prototype,
            'value',
        )?.set;
        nativeSetter?.call(slider, '6');
        slider.dispatchEvent(new Event('change', { bubbles: true }));

        expect(onChange).toHaveBeenLastCalledWith(
            expect.objectContaining({ minOnlineCoop: 6 }),
        );
    });
});
