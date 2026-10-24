import { beforeEach, describe, expect, it, vi } from 'vitest';
import { startTransition, type JSX } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { server } from '../../../test/mocks/server';
import { renderWithProviders } from '../../../test/render-helpers';
import {
    valheimCharacterUnclaimed,
    valheimCharactersHandler,
} from '../../../test/mocks/valheim-armory-handlers';
import {
    DEFAULT_PIN_FILTER,
    activeFilterCount,
    clearPinFilters,
    parsePinFilter,
    writePinFilter,
    type PinFilter,
} from './pin-filter';
import { MapPinFilters, PinSummaryLine } from './map-filter-toolbar';
import type { PinFilterPanelState, PinFilterSummary } from './use-pin-filter';

const mq = vi.hoisted(() => ({ wide: true }));
vi.mock('../../../hooks/use-media-query', () => ({
    useMediaQuery: () => mq.wide,
}));

const RULED_ORDER = [
    'death',
    'bed',
    'portal',
    'scanned-portal',
    'boss',
    'home',
    'fire',
    'workshop',
    'mine',
    'shout',
    'hildir',
    'other',
];

function panelState(
    filter: Partial<PinFilter> = {},
    over: Partial<PinFilterPanelState> = {},
): PinFilterPanelState {
    return {
        filter: { ...DEFAULT_PIN_FILTER, ...filter },
        playersAvailable: true,
        activeCount: 0,
        onChange: vi.fn(),
        onToggleType: vi.fn(),
        onClearAll: vi.fn(),
        ...over,
    };
}

function summaryState(over: Partial<PinFilterSummary> = {}): PinFilterSummary {
    return {
        activeCount: 0,
        count: 3,
        status: 'idle',
        truncated: false,
        onRetry: vi.fn(),
        onClear: vi.fn(),
        portalsError: false,
        portalsOmitted: 0,
        onRetryPortals: vi.fn(),
        ...over,
    };
}

function renderFilters(
    panel: PinFilterPanelState,
    serverId: number | null = 3,
) {
    renderWithProviders(
        <MapPinFilters
            filter={{ panel, summary: summaryState() }}
            serverId={serverId ?? undefined}
        />,
    );
    fireEvent.click(screen.getByRole('button', { name: /^Filters/ }));
}

beforeEach(() => {
    mq.wide = true;
    server.use(
        valheimCharactersHandler([
            { ...valheimCharacterUnclaimed, id: 11, name: 'Ragnhild' },
            { ...valheimCharacterUnclaimed, id: 12, name: 'Hrafn' },
        ]),
    );
});

describe('PinFilterPanel — pin types (S18)', () => {
    it('renders all 12 chips in the ruled order, none pressed for every type', () => {
        renderFilters(panelState());
        const chips = within(
            screen.getByTestId('map-pin-filter-types'),
        ).getAllByRole('button');
        expect(chips.map((c) => c.getAttribute('data-testid'))).toEqual(
            RULED_ORDER.map((id) => `map-pin-type-${id}`),
        );
        expect(
            chips.every((c) => c.getAttribute('aria-pressed') === 'false'),
        ).toBe(true);
        expect(
            screen.getByRole('button', { name: 'All types' }),
        ).toBeDisabled();
    });

    it('a chip click toggles its group; "All types" resets to every type', () => {
        const panel = panelState({ types: new Set(['death']) });
        renderFilters(panel);
        expect(screen.getByTestId('map-pin-type-death')).toHaveAttribute(
            'aria-pressed',
            'true',
        );
        fireEvent.click(screen.getByTestId('map-pin-type-portal'));
        expect(panel.onToggleType).toHaveBeenCalledWith('portal');
        fireEvent.click(screen.getByRole('button', { name: 'All types' }));
        expect(panel.onChange).toHaveBeenCalledWith({ types: null });
    });
});

describe('PinFilterPanel — whose pins (S19/S20)', () => {
    it('Everyone writes players=all and shows the cartography hint', () => {
        const panel = panelState();
        renderFilters(panel);
        expect(screen.queryByText(/Cartography-table copies/)).toBeNull();
        fireEvent.click(screen.getByRole('radio', { name: 'Everyone' }));
        expect(panel.onChange).toHaveBeenCalledWith({ players: 'all' });
    });

    it('Choose players reveals the server’s characters by name; ticking one writes its id', async () => {
        const panel = panelState();
        renderFilters(panel);
        fireEvent.click(screen.getByRole('radio', { name: 'Choose players' }));
        const list = await screen.findByTestId('map-pin-filter-player-list');
        const hrafn = within(list).getByRole('checkbox', { name: 'Hrafn' });
        const order = hrafn.compareDocumentPosition(
            within(list).getByRole('checkbox', { name: 'Ragnhild' }),
        );
        expect(
            order & Node.DOCUMENT_POSITION_FOLLOWING,
            'sorted by name: Hrafn before Ragnhild',
        ).toBeTruthy();
        fireEvent.click(
            within(list).getByRole('checkbox', { name: 'Ragnhild' }),
        );
        expect(panel.onChange).toHaveBeenLastCalledWith({ players: [11] });
    });

    it('with a pick, ticking adds and unticking the last one falls back to this character', async () => {
        const panel = panelState({ players: [11] });
        renderFilters(panel);
        expect(
            screen.getByRole('radio', { name: 'Choose players' }),
        ).toBeChecked();
        expect(
            await screen.findByRole('checkbox', { name: 'Ragnhild' }),
        ).toBeChecked();
        expect(
            screen.getByText(/Cartography-table copies/),
        ).toBeInTheDocument();
        fireEvent.click(screen.getByRole('checkbox', { name: 'Hrafn' }));
        expect(panel.onChange).toHaveBeenLastCalledWith({ players: [11, 12] });
        fireEvent.click(screen.getByRole('checkbox', { name: 'Ragnhild' }));
        expect(panel.onChange).toHaveBeenLastCalledWith({
            players: 'character',
        });
    });

    it('without a server (character page) there is no Whose pins section', () => {
        renderFilters(panelState({}, { playersAvailable: false }), null);
        expect(screen.queryByRole('radio', { name: 'Everyone' })).toBeNull();
        expect(
            screen.getByRole('searchbox', { name: 'Search pin labels' }),
        ).toBeInTheDocument();
    });
});

describe('PinFilterPanel — search, crossed-out, clear', () => {
    it('typing a label search writes q after the debounce', async () => {
        const panel = panelState();
        renderFilters(panel);
        fireEvent.change(
            screen.getByRole('searchbox', { name: 'Search pin labels' }),
            { target: { value: 'base' } },
        );
        await waitFor(() =>
            expect(panel.onChange).toHaveBeenCalledWith({ query: 'base' }),
        );
    });

    it('Hide crossed-out pins is a checkbox writing hideCrossed', () => {
        const panel = panelState();
        renderFilters(panel);
        fireEvent.click(
            screen.getByRole('checkbox', { name: 'Hide crossed-out pins' }),
        );
        expect(panel.onChange).toHaveBeenCalledWith({ hideCrossed: true });
    });

    it('Hide crossed-out pins shows the click at once, before the URL write lands', () => {
        // The router commits the URL write in a transition, so the filter prop is
        // still false right after the click (here: onChange never re-renders).
        renderFilters(panelState());
        const box = screen.getByRole('checkbox', {
            name: 'Hide crossed-out pins',
        });
        fireEvent.click(box);
        expect(
            box,
            'checked while the URL write is still pending',
        ).toBeChecked();
    });

    it('Clear all (shown while filters are active) calls the hook’s clear', () => {
        const panel = panelState({ query: 'base' }, { activeCount: 2 });
        renderFilters(panel);
        expect(
            screen.getByRole('searchbox', { name: 'Search pin labels' }),
        ).toHaveValue('base');
        fireEvent.click(screen.getByRole('button', { name: 'Clear all' }));
        expect(panel.onClearAll).toHaveBeenCalledTimes(1);
    });
});

describe('MapPinFilters — phone path (D16)', () => {
    it('below 1024px the Filters FAB opens the panel in a bottom sheet', () => {
        mq.wide = false;
        renderFilters(panelState());
        const sheet = screen.getByRole('dialog');
        expect(
            within(sheet).getByTestId('map-pin-filter-panel'),
        ).toBeInTheDocument();
        expect(
            within(sheet).getByTestId('map-pin-type-death'),
        ).toBeInTheDocument();
        expect(
            within(sheet).getByRole('checkbox', {
                name: 'Hide crossed-out pins',
            }),
        ).toBeInTheDocument();
    });
});

describe('PinSummaryLine (D15)', () => {
    it('loading reads "Loading pins…" and offers no Clear filters while the layer is in flight', () => {
        renderWithProviders(
            <PinSummaryLine
                summary={summaryState({
                    status: 'loading',
                    activeCount: 1,
                    count: 0,
                })}
                onClear={vi.fn()}
            />,
        );
        expect(screen.getByRole('status')).toHaveTextContent('Loading pins…');
        expect(
            screen.queryByRole('button', { name: 'Clear filters' }),
        ).toBeNull();
    });

    it('a visitor (forbidden) gets the member hint, and with filters active still the Clear filters way out', () => {
        const onClear = vi.fn();
        renderWithProviders(
            <PinSummaryLine
                summary={summaryState({
                    status: 'forbidden',
                    activeCount: 1,
                    count: 0,
                })}
                onClear={onClear}
            />,
        );
        expect(screen.getByRole('status')).toHaveTextContent(
            "Other players' pins are visible to hub members.",
        );
        fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
        expect(onClear).toHaveBeenCalledTimes(1);
    });

    it('ROK-1946 D15: a failed portal layer shows its own danger chip + Retry; omitted portals are counted', () => {
        const onRetryPortals = vi.fn();
        renderWithProviders(
            <PinSummaryLine
                summary={summaryState({ portalsError: true, portalsOmitted: 4, onRetryPortals })}
                onClear={vi.fn()}
            />,
        );
        const line = screen.getByRole('status');
        expect(line).toHaveTextContent('Portals could not be loaded');
        expect(line).toHaveTextContent('Some portals were not uploaded (4).');
        expect(line).not.toHaveTextContent('Pins could not be loaded');
        fireEvent.click(within(line).getByRole('button', { name: 'Retry' }));
        expect(onRetryPortals).toHaveBeenCalledTimes(1);
    });

    it('no active filters and no pins says nothing extra', () => {
        renderWithProviders(
            <PinSummaryLine
                summary={summaryState({ count: 0 })}
                onClear={vi.fn()}
            />,
        );
        expect(screen.getByRole('status')).toBeEmptyDOMElement();
    });
});

/**
 * The filter wired to the URL the way `usePinFilter` is, with every write
 * committed in `startTransition` as BrowserRouter (react-router 7) does.
 */
function RoutedFilters(): JSX.Element {
    const location = useLocation();
    const navigate = useNavigate();
    const params = (): URLSearchParams => new URLSearchParams(location.search);
    const write = (next: URLSearchParams): void => {
        const search = next.toString();
        startTransition(() => {
            void navigate(
                { search: search ? `?${search}` : '' },
                { replace: true },
            );
        });
    };
    const filter = parsePinFilter(params());
    const panel: PinFilterPanelState = {
        filter,
        playersAvailable: true,
        activeCount: activeFilterCount(filter),
        onChange: (patch) => write(writePinFilter(params(), patch, 7)),
        onToggleType: vi.fn(),
        onClearAll: () => write(clearPinFilters(params(), 7)),
    };
    return (
        <>
            <span data-testid="url">{location.search}</span>
            <button
                type="button"
                onClick={() =>
                    write(writePinFilter(params(), { query: 'iron' }, 7))
                }
            >
                External iron
            </button>
            <MapPinFilters
                filter={{
                    panel,
                    summary: summaryState({ activeCount: panel.activeCount }),
                }}
                serverId={3}
            />
        </>
    );
}

describe('MapPinFilters — Clear under a transition-committed URL', () => {
    it('Clear empties the search box and returns Whose pins to this character once the URL commits', async () => {
        renderWithProviders(<RoutedFilters />);
        fireEvent.click(screen.getByRole('button', { name: /^Filters/ }));
        const search = screen.getByRole('searchbox', {
            name: 'Search pin labels',
        });
        fireEvent.change(search, { target: { value: 'base' } });
        await waitFor(() =>
            expect(screen.getByTestId('url').textContent).toContain('base'),
        );
        fireEvent.click(screen.getByRole('radio', { name: 'Choose players' }));
        fireEvent.click(
            within(
                await screen.findByTestId('map-pin-filter-player-list'),
            ).getByRole('checkbox', { name: 'Ragnhild' }),
        );
        await waitFor(() =>
            expect(screen.getByTestId('url').textContent).toContain('11'),
        );
        fireEvent.click(screen.getByRole('button', { name: 'Clear all' }));
        await waitFor(() =>
            expect(screen.getByTestId('url').textContent).not.toContain('base'),
        );
        expect(
            screen.getByRole('searchbox', { name: 'Search pin labels' }),
            'search text after Clear',
        ).toHaveValue('');
        expect(
            screen.getByRole('radio', { name: 'This character' }),
            'Whose pins after Clear',
        ).toBeChecked();
        expect(
            screen.queryByTestId('map-pin-filter-player-list'),
            'player list hidden after Clear',
        ).toBeNull();
    });
});

describe('MapPinFilters — label search follows the URL', () => {
    it('an external URL change (Back/Forward, a link) replaces the search box text', async () => {
        renderWithProviders(<RoutedFilters />);
        fireEvent.click(screen.getByRole('button', { name: /^Filters/ }));
        fireEvent.change(
            screen.getByRole('searchbox', { name: 'Search pin labels' }),
            { target: { value: 'copper' } },
        );
        await waitFor(() =>
            expect(screen.getByTestId('url').textContent).toContain('copper'),
        );
        fireEvent.click(screen.getByRole('button', { name: 'External iron' }));
        await waitFor(() =>
            expect(screen.getByTestId('url').textContent).toContain('iron'),
        );
        expect(
            screen.getByRole('searchbox', { name: 'Search pin labels' }),
            'search text after an external q change',
        ).toHaveValue('iron');
    });

    it("a trailing space survives the commit of the box's own write (the URL stores q trimmed)", async () => {
        renderWithProviders(<RoutedFilters />);
        fireEvent.click(screen.getByRole('button', { name: /^Filters/ }));
        fireEvent.change(
            screen.getByRole('searchbox', { name: 'Search pin labels' }),
            { target: { value: 'iron ' } },
        );
        await waitFor(() =>
            expect(screen.getByTestId('url').textContent).toContain('q=iron'),
        );
        expect(
            screen.getByRole('searchbox', { name: 'Search pin labels' }),
            'draft after its own write commits',
        ).toHaveValue('iron ');
    });
});
