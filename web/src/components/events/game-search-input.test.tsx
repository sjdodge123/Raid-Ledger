/**
 * ROK-1647 — GameSearchInput (and the poll's PollGameSearch wrapper) on the
 * shared Combobox: ↑/↓ move the highlight, Enter picks, Esc closes, and the
 * existing behaviour (clear-on-edit, suggestions on focus, test ids) holds.
 */
import { useState, type JSX } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { IgdbGameDto } from '@raid-ledger/contract';
import { GameSearchInput } from './game-search-input';
import { PollGameSearch } from '../scheduling/poll-game-search';

vi.mock('../../hooks/use-game-search', () => ({ useGameSearch: vi.fn() }));
import { useGameSearch } from '../../hooks/use-game-search';

const game = (id: number, name: string): IgdbGameDto => ({ id, igdbId: id, name, slug: name.toLowerCase(), coverUrl: null } as IgdbGameDto);
const WOW = game(1, 'World of Warcraft');
const WOWF = game(2, 'World of Warcraft: Forever');
const HADES = game(3, 'Hades');

function mockResults(games: IgdbGameDto[], source = 'igdb'): void {
    vi.mocked(useGameSearch).mockImplementation((q: string) => ({
        data: q.length >= 2 ? { data: games, meta: { source } } : undefined,
        isLoading: false,
    }) as unknown as ReturnType<typeof useGameSearch>);
}

function Harness({ spy, initial = null, poll = false, suggestions }: {
    spy: (g: IgdbGameDto | null) => void; initial?: IgdbGameDto | null; poll?: boolean; suggestions?: IgdbGameDto[];
}): JSX.Element {
    const [value, setValue] = useState<IgdbGameDto | null>(initial);
    const onChange = (g: IgdbGameDto | null): void => { setValue(g); spy(g); };
    return poll
        ? <PollGameSearch value={value} onChange={onChange} />
        : <GameSearchInput value={value} onChange={onChange} initialSuggestions={suggestions} />;
}

const box = (): HTMLElement => screen.getByRole('combobox', { name: 'Game' });

beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
    // The MAJOR-1 specs read mock.calls; clear explicitly rather than lean on
    // vitest's clearMocks default (true in v5, false in v4).
    vi.mocked(useGameSearch).mockClear();
    mockResults([WOW, WOWF]);
});

describe('GameSearchInput — keyboard contract (ROK-1647)', () => {
    it('is a combobox named by its "Game" label', () => {
        render(<Harness spy={vi.fn()} />);
        expect(box()).toHaveAttribute('placeholder', 'Search for a game...');
        expect(box()).toHaveAttribute('aria-expanded', 'false');
    });

    it('ArrowDown moves the highlight and Enter picks the highlighted game', async () => {
        const spy = vi.fn();
        render(<Harness spy={spy} />);
        await userEvent.type(box(), 'Wo{ArrowDown}{ArrowDown}');
        const second = screen.getByRole('option', { name: WOWF.name });
        expect(box()).toHaveAttribute('aria-activedescendant', second.id);
        await userEvent.keyboard('{Enter}');
        expect(spy).toHaveBeenLastCalledWith(WOWF);
        expect(box()).toHaveValue(WOWF.name);
        expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });

    it('ArrowUp wraps to the last game', async () => {
        const spy = vi.fn();
        render(<Harness spy={spy} />);
        await userEvent.type(box(), 'Wo{ArrowUp}{Enter}');
        expect(spy).toHaveBeenLastCalledWith(WOWF);
    });

    it('Escape closes the results without picking', async () => {
        const spy = vi.fn();
        render(<Harness spy={spy} />);
        await userEvent.type(box(), 'Wo');
        expect(screen.getByRole('listbox')).toBeInTheDocument();
        await userEvent.keyboard('{Escape}');
        expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
        expect(box()).toHaveAttribute('aria-expanded', 'false');
        expect(box()).toHaveValue('Wo');
        expect(spy).not.toHaveBeenCalled();
    });

    it('picking a different game replaces the selection (the label echo does not clear it)', async () => {
        const spy = vi.fn();
        render(<Harness spy={spy} initial={WOW} suggestions={[HADES, WOWF]} />);
        // Focus offers the suggestions; move to the other game without editing.
        await userEvent.click(box());
        await userEvent.keyboard('{ArrowDown}{ArrowDown}{Enter}');
        expect(spy, 'the picked game must not be cleared by the label write-back').toHaveBeenLastCalledWith(WOWF);
        expect(screen.getByText(WOWF.name, { selector: 'span.text-success' })).toBeInTheDocument();
    });

    it('editing the text away from the picked name clears the selection', async () => {
        const spy = vi.fn();
        render(<Harness spy={spy} initial={HADES} />);
        await userEvent.type(box(), 'x');
        expect(spy).toHaveBeenLastCalledWith(null);
    });

});

describe('GameSearchInput — behaviour (ROK-1647)', () => {
    it('shows "No games found" for an empty search', async () => {
        mockResults([]);
        render(<Harness spy={vi.fn()} />);
        await userEvent.type(box(), 'zzz');
        expect(screen.getByRole('status')).toHaveTextContent('No games found');
    });

    it('offers initialSuggestions on focus, before typing', async () => {
        const spy = vi.fn();
        render(<Harness spy={spy} suggestions={[HADES]} />);
        await userEvent.click(box());
        expect(screen.getByRole('option', { name: HADES.name })).toBeInTheDocument();
        await userEvent.keyboard('{ArrowDown}{Enter}');
        expect(spy).toHaveBeenLastCalledWith(HADES);
    });
});

describe('GameSearchInput — searches only after user input (ROK-1647 MAJOR-1)', () => {
    const searchedWithEnabled = (): boolean => vi.mocked(useGameSearch).mock.calls.some(([, enabled]) => enabled === true);
    const lastEnabled = (): boolean | undefined => vi.mocked(useGameSearch).mock.lastCall?.[1];
    const LOCAL_NOTE = 'Showing local results (external search unavailable)';

    it('a prefilled game does not search on mount or show the local-results note', () => {
        mockResults([WOW], 'local');
        render(<Harness spy={vi.fn()} initial={WOW} />);
        expect(searchedWithEnabled(), 'a prefilled value must not enable the game search on mount').toBe(false);
        expect(screen.queryByText(LOCAL_NOTE), 'the note must not show while the popup is closed').not.toBeInTheDocument();
    });

    it('picking a game stops the search until the next edit', async () => {
        mockResults([WOW, WOWF], 'local');
        render(<Harness spy={vi.fn()} />);
        await userEvent.type(box(), 'Wo');
        expect(screen.getByText(LOCAL_NOTE)).toBeInTheDocument();
        await userEvent.keyboard('{ArrowDown}{Enter}');
        expect(lastEnabled(), 'after a pick the search must be switched off').toBe(false);
        await userEvent.click(box());
        expect(lastEnabled(), 'refocusing the picked game must not switch it back on').toBe(false);
        expect(screen.queryByText(LOCAL_NOTE), 'the note must not show after a pick closed the popup').not.toBeInTheDocument();
        await userEvent.type(box(), 'x');
        expect(lastEnabled(), 'the next edit re-enables the search').toBe(true);
    });

    it('"Clear selection" clears the value, empties the text and refocuses the box', async () => {
        const spy = vi.fn();
        render(<Harness spy={spy} initial={HADES} />);
        await userEvent.click(screen.getByRole('button', { name: 'Clear selection' }));
        expect(spy).toHaveBeenLastCalledWith(null);
        expect(box()).toHaveValue('');
        expect(box()).toHaveFocus();
        expect(screen.queryByRole('listbox'), 'clearing with no suggestions must not open an empty popup').not.toBeInTheDocument();
    });
});

describe('PollGameSearch — keeps the smoke test ids', () => {
    it('exposes game-search-input / -results / game-option and picks by keyboard', async () => {
        const spy = vi.fn();
        render(<Harness spy={spy} poll />);
        await userEvent.type(screen.getByTestId('game-search-input'), 'Wo');
        expect(screen.getByTestId('game-search-results')).toBeInTheDocument();
        const options = screen.getAllByTestId('game-option');
        expect(options).toHaveLength(2);
        expect(options[0], 'game-option must sit on the role="option" row').toHaveAttribute('role', 'option');
        await userEvent.keyboard('{ArrowDown}{Enter}');
        expect(spy).toHaveBeenLastCalledWith(WOW);
    });
});
