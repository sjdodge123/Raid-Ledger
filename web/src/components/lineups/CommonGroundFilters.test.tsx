/**
 * Tests for CommonGroundFilters (ROK-934).
 * Validates slider, genre dropdown, and max players input behavior.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { CommonGroundParams } from '../../lib/api-client';
import { CommonGroundFilters } from './CommonGroundFilters';

const defaultFilters: CommonGroundParams = {
    minOwners: 2,
    genre: undefined,
    maxPlayers: undefined,
};

describe('CommonGroundFilters — min owners slider', () => {
    it('renders the "Min owners" label', () => {
        render(
            <CommonGroundFilters
                filters={defaultFilters}
                onChange={vi.fn()}
                search=""
                onSearchChange={vi.fn()}
            />,
        );
        expect(screen.getByText('Min owners')).toBeInTheDocument();
    });

    it('renders slider with correct default value', () => {
        render(
            <CommonGroundFilters
                filters={{ ...defaultFilters, minOwners: 5 }}
                onChange={vi.fn()}
                search=""
                onSearchChange={vi.fn()}
            />,
        );
        const slider = screen.getByRole('slider', { name: /min owners/i });
        expect(slider).toHaveValue('5');
    });

    it('defaults to 2 when minOwners is undefined', () => {
        render(
            <CommonGroundFilters
                filters={{ ...defaultFilters, minOwners: undefined }}
                onChange={vi.fn()}
                search=""
                onSearchChange={vi.fn()}
            />,
        );
        const slider = screen.getByRole('slider', { name: /min owners/i });
        expect(slider).toHaveValue('2');
    });

    it('displays current value as text', () => {
        render(
            <CommonGroundFilters
                filters={{ ...defaultFilters, minOwners: 8 }}
                onChange={vi.fn()}
                search=""
                onSearchChange={vi.fn()}
            />,
        );
        expect(screen.getByText('8')).toBeInTheDocument();
    });

    it('calls onChange with updated minOwners when slider changes', () => {
        const onChange = vi.fn();
        render(
            <CommonGroundFilters
                filters={{ ...defaultFilters, minOwners: 2 }}
                onChange={onChange}
                search=""
                onSearchChange={vi.fn()}
            />,
        );
        const slider = screen.getByRole('slider', { name: /min owners/i });
        // Range inputs require native value setter + input event
        const nativeSetter = Object.getOwnPropertyDescriptor(
            HTMLInputElement.prototype,
            'value',
        )?.set;
        nativeSetter?.call(slider, '7');
        slider.dispatchEvent(new Event('change', { bubbles: true }));

        expect(onChange).toHaveBeenCalledWith({
            ...defaultFilters,
            minOwners: 7,
        });
    });
});

// ROK-1297 round 5ad: the genre-dropdown describe block was removed
// after the operator dropped the dropdown from the filter bar. The
// `availableTags` prop remains on CommonGroundFilters for caller-shape
// compatibility but no UI consumes it.

describe('CommonGroundFilters — players slider', () => {
    it('renders the "Players" label', () => {
        render(
            <CommonGroundFilters
                filters={defaultFilters}
                onChange={vi.fn()}
                search=""
                onSearchChange={vi.fn()}
            />,
        );
        expect(screen.getByText('Players')).toBeInTheDocument();
    });

    it('shows "Any" when maxPlayers is undefined (slider at 0)', () => {
        render(
            <CommonGroundFilters
                filters={{ ...defaultFilters, maxPlayers: undefined }}
                onChange={vi.fn()}
                search=""
                onSearchChange={vi.fn()}
            />,
        );
        expect(screen.getByText('Any')).toBeInTheDocument();
    });

    it('shows numeric value when maxPlayers is set', () => {
        render(
            <CommonGroundFilters
                filters={{ ...defaultFilters, maxPlayers: 4 }}
                onChange={vi.fn()}
                search=""
                onSearchChange={vi.fn()}
            />,
        );
        const slider = screen.getByRole('slider', { name: /players/i });
        expect(slider).toHaveValue('4');
    });
});

describe('CommonGroundFilters — participantCount auto-set (ROK-1255)', () => {
    it('auto-sets maxPlayers to participantCount on first mount when filter is unset', () => {
        const onChange = vi.fn();
        render(
            <CommonGroundFilters
                filters={{ ...defaultFilters, maxPlayers: undefined }}
                onChange={onChange}
                search=""
                onSearchChange={vi.fn()}
                participantCount={3}
            />,
        );
        expect(onChange).toHaveBeenCalledWith({
            ...defaultFilters,
            maxPlayers: 3,
        });
    });

    it('preserves manual adjustment across re-renders (does not snap back to participantCount)', () => {
        const onChange = vi.fn();
        const { rerender } = render(
            <CommonGroundFilters
                filters={{ ...defaultFilters, maxPlayers: undefined }}
                onChange={onChange}
                search=""
                onSearchChange={vi.fn()}
                participantCount={3}
            />,
        );
        // First mount: auto-set fires once with maxPlayers: 3
        expect(onChange).toHaveBeenCalledTimes(1);
        expect(onChange).toHaveBeenLastCalledWith({
            ...defaultFilters,
            maxPlayers: 3,
        });

        // Simulate parent committing the auto-set, then user manually adjusts to 5.
        rerender(
            <CommonGroundFilters
                filters={{ ...defaultFilters, maxPlayers: 5 }}
                onChange={onChange}
                search=""
                onSearchChange={vi.fn()}
                participantCount={3}
            />,
        );
        // No new onChange call from the effect — manual value sticks.
        expect(onChange).toHaveBeenCalledTimes(1);

        // Even if participantCount later changes (e.g. invitees added), no re-pin.
        rerender(
            <CommonGroundFilters
                filters={{ ...defaultFilters, maxPlayers: 5 }}
                onChange={onChange}
                search=""
                onSearchChange={vi.fn()}
                participantCount={7}
            />,
        );
        expect(onChange).toHaveBeenCalledTimes(1);
    });

    it('falls back to default (no auto-set) when participantCount is 0', () => {
        const onChange = vi.fn();
        render(
            <CommonGroundFilters
                filters={{ ...defaultFilters, maxPlayers: undefined }}
                onChange={onChange}
                search=""
                onSearchChange={vi.fn()}
                participantCount={0}
            />,
        );
        expect(onChange).not.toHaveBeenCalled();
        expect(screen.getByText('Any')).toBeInTheDocument();
    });

    it('falls back to default (no auto-set) when participantCount is undefined', () => {
        const onChange = vi.fn();
        render(
            <CommonGroundFilters
                filters={{ ...defaultFilters, maxPlayers: undefined }}
                onChange={onChange}
                search=""
                onSearchChange={vi.fn()}
            />,
        );
        expect(onChange).not.toHaveBeenCalled();
        expect(screen.getByText('Any')).toBeInTheDocument();
    });

    // ROK-1348: a brand-new lineup has participantCount === 1 (creator only).
    // Auto-pinning maxPlayers to 1 would filter out every multiplayer game,
    // so <= 1 must be treated as "no auto-set".
    it('does NOT auto-set when participantCount is 1 (creator-only new lineup)', () => {
        const onChange = vi.fn();
        render(
            <CommonGroundFilters
                filters={{ ...defaultFilters, maxPlayers: undefined }}
                onChange={onChange}
                search=""
                onSearchChange={vi.fn()}
                participantCount={1}
            />,
        );
        expect(onChange).not.toHaveBeenCalled();
        expect(screen.getByText('Any')).toBeInTheDocument();
    });

    it('does not auto-set when maxPlayers is already set (e.g. URL/state hydration)', () => {
        const onChange = vi.fn();
        render(
            <CommonGroundFilters
                filters={{ ...defaultFilters, maxPlayers: 4 }}
                onChange={onChange}
                search=""
                onSearchChange={vi.fn()}
                participantCount={3}
            />,
        );
        expect(onChange).not.toHaveBeenCalled();
    });

    it('captures participantCount the first time it becomes known (initial 0 then arrives)', () => {
        const onChange = vi.fn();
        const { rerender } = render(
            <CommonGroundFilters
                filters={{ ...defaultFilters, maxPlayers: undefined }}
                onChange={onChange}
                search=""
                onSearchChange={vi.fn()}
                participantCount={0}
            />,
        );
        expect(onChange).not.toHaveBeenCalled();

        // Data loads — participantCount now 4. Effect should fire exactly once.
        rerender(
            <CommonGroundFilters
                filters={{ ...defaultFilters, maxPlayers: undefined }}
                onChange={onChange}
                search=""
                onSearchChange={vi.fn()}
                participantCount={4}
            />,
        );
        expect(onChange).toHaveBeenCalledTimes(1);
        expect(onChange).toHaveBeenLastCalledWith({
            ...defaultFilters,
            maxPlayers: 4,
        });
    });
});
