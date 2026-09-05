/**
 * ROK-1478 AC1/AC2 — the "Players are looking" filter is a two-way toggle.
 *
 * Before this story `LfgFilterChip` returned `null` unless `?lfg=1` was already
 * in the URL (`lfg-filter-chip.tsx:18`), so the ONLY way into the filtered view
 * was the events banner. There was no affordance to turn it on, and the single
 * affordance to turn it off was a ✕ that only existed once you were already in.
 *
 * Contract pinned here (spec ROK-1478 decisions D1/D2):
 *   • ONE element carries `data-testid="lfg-filter-chip"` — the smoke spec
 *     `lfg-chips.smoke.spec.ts:332` pins that testid, so it must not move;
 *   • it is a `<button>` with `aria-pressed` reflecting the param, present in
 *     BOTH states and never `disabled` (AC2 — an empty community must still be
 *     able to look);
 *   • pressing it writes `lfg=1` and pressing it again removes `lfg` — and in
 *     both directions every other search param survives.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useSearchParams } from 'react-router-dom';
import { server } from '../../test/mocks/server';
import { lfgGroupsHandler } from '../../test/mocks/lfg-handlers';
import { buildLfgGroupSummary } from '../../test/factories/lfg';
import { ACCESS_TOKEN_KEY } from '../../lib/api/auth-storage-keys';
import { renderWithProviders } from '../../test/render-helpers';
import { LfgFilterChip } from './lfg-filter-chip';
import { LfgLookingGrid } from './lfg-looking-grid';

/** Exposes the live query string so a click's effect is observable. */
function SearchProbe() {
    const [params] = useSearchParams();
    return <span data-testid="search-probe">{params.toString()}</span>;
}

function renderChip(url: string) {
    return renderWithProviders(
        <>
            <LfgFilterChip />
            <SearchProbe />
        </>,
        { initialEntries: [url] },
    );
}

/** The live query string, parsed. */
function search(): URLSearchParams {
    return new URLSearchParams(
        screen.getByTestId('search-probe').textContent ?? '',
    );
}

function toggle(): HTMLElement {
    return screen.getByTestId('lfg-filter-chip');
}

beforeEach(() => {
    localStorage.setItem(ACCESS_TOKEN_KEY, 'test-token');
    server.use(lfgGroupsHandler([buildLfgGroupSummary({ gameId: 1 })]));
});

describe('LfgFilterChip — visible in both states (AC1)', () => {
    it('renders with aria-pressed="false" when the filter is off', () => {
        renderChip('/games');

        expect(toggle()).toHaveAttribute('aria-pressed', 'false');
    });

    it('renders with aria-pressed="true" when deep-linked with lfg=1', () => {
        renderChip('/games?lfg=1');

        expect(toggle()).toHaveAttribute('aria-pressed', 'true');
    });

    it('is a button and keeps the accessible name "Players are looking"', () => {
        renderChip('/games');

        expect(toggle().tagName).toBe('BUTTON');
        expect(
            screen.getByRole('button', { name: /players are looking/i }),
        ).toBe(toggle());
    });
});

describe('LfgFilterChip — writing the param (AC1)', () => {
    it('turns the filter on without dropping the search query', async () => {
        const user = userEvent.setup();
        renderChip('/games?q=deep');

        await user.click(toggle());

        await waitFor(() => expect(search().get('lfg')).toBe('1'));
        expect(search().get('q')).toBe('deep');
        expect(toggle()).toHaveAttribute('aria-pressed', 'true');
    });

    it('turns the filter off again without dropping the search query', async () => {
        const user = userEvent.setup();
        renderChip('/games?lfg=1&q=deep');

        await user.click(toggle());

        await waitFor(() => expect(search().get('lfg')).toBeNull());
        expect(search().get('q')).toBe('deep');
        expect(toggle()).toHaveAttribute('aria-pressed', 'false');
    });
});

describe('LfgFilterChip — nobody is looking (AC2)', () => {
    it('stays enabled when GET /lfg resolves empty', async () => {
        server.use(lfgGroupsHandler([]));
        renderChip('/games');

        // Let the (empty) read land before asserting the toggle survived it.
        await waitFor(() => expect(toggle()).toBeInTheDocument());
        expect(toggle()).not.toBeDisabled();
        expect(toggle()).toHaveAttribute('aria-pressed', 'false');
    });

    it('stays pressed alongside the empty grid copy', async () => {
        server.use(lfgGroupsHandler([]));
        renderWithProviders(
            <>
                <LfgFilterChip />
                <LfgLookingGrid />
            </>,
            { initialEntries: ['/games?lfg=1'] },
        );

        expect(
            await screen.findByText(/nobody is looking right now/i),
        ).toBeInTheDocument();
        expect(toggle()).toHaveAttribute('aria-pressed', 'true');
        expect(toggle()).not.toBeDisabled();
    });
});
