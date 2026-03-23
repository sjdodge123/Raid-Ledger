/**
 * Tests for CommonGroundFilters (ROK-934).
 * Validates slider, genre dropdown, and max players input behavior.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
                availableTags={[]}
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
                availableTags={[]}
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
                availableTags={[]}
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
                availableTags={[]}
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
                availableTags={[]}
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

describe('CommonGroundFilters — genre dropdown', () => {
    const tags = ['RPG', 'Survival', 'Co-op'];

    it('renders "All genres" option', () => {
        render(
            <CommonGroundFilters
                filters={defaultFilters}
                onChange={vi.fn()}
                availableTags={tags}
            />,
        );
        expect(screen.getByRole('option', { name: 'All genres' })).toBeInTheDocument();
    });

    it('renders all available tags as options', () => {
        render(
            <CommonGroundFilters
                filters={defaultFilters}
                onChange={vi.fn()}
                availableTags={tags}
            />,
        );
        for (const tag of tags) {
            expect(screen.getByRole('option', { name: tag })).toBeInTheDocument();
        }
    });

    it('calls onChange with updated genre when a tag is selected', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        render(
            <CommonGroundFilters
                filters={defaultFilters}
                onChange={onChange}
                availableTags={tags}
            />,
        );
        const select = screen.getByRole('combobox');
        await user.selectOptions(select, 'Survival');
        expect(onChange).toHaveBeenCalledWith({
            ...defaultFilters,
            genre: 'Survival',
        });
    });

    it('calls onChange with undefined genre when "All genres" is selected', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        render(
            <CommonGroundFilters
                filters={{ ...defaultFilters, genre: 'RPG' }}
                onChange={onChange}
                availableTags={tags}
            />,
        );
        const select = screen.getByRole('combobox');
        await user.selectOptions(select, 'All genres');
        expect(onChange).toHaveBeenCalledWith({
            ...defaultFilters,
            genre: undefined,
        });
    });

    it('renders empty dropdown when no tags are available', () => {
        render(
            <CommonGroundFilters
                filters={defaultFilters}
                onChange={vi.fn()}
                availableTags={[]}
                search=""
                onSearchChange={vi.fn()}
            />,
        );
        const select = screen.getByRole('combobox');
        // Only the "All genres" option should exist
        const options = select.querySelectorAll('option');
        expect(options).toHaveLength(1);
        expect(options[0]).toHaveTextContent('All genres');
    });
});

describe('CommonGroundFilters — players slider', () => {
    it('renders the "Players" label', () => {
        render(
            <CommonGroundFilters
                filters={defaultFilters}
                onChange={vi.fn()}
                availableTags={[]}
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
                availableTags={[]}
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
                availableTags={[]}
                search=""
                onSearchChange={vi.fn()}
            />,
        );
        const slider = screen.getByRole('slider', { name: /players/i });
        expect(slider).toHaveValue('4');
    });
});
