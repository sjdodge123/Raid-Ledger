import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useParams } from 'react-router-dom';
import type { JSX } from 'react';
import type { MyGuild } from '@raid-ledger/contract';
import { parseHubParam } from '../../../pages/lfg/lfg-hub-param';
import { blockWebStorage } from '../../../test/block-web-storage';
import { LfgHubPicker } from './lfg-hub-picker';
import { LAST_HUB_STORAGE_KEY } from './lfg-hub-picker-state';
import { CLASSIC, FOREVER, REGISTRY, VALHEIM, myHub } from './lfg-hub-picker.fixtures';

const hubsState = vi.hoisted(() => ({ guilds: [] as MyGuild[], isSuccess: true }));
vi.mock('../../../components/layout/hub-nav/my-hubs-queries', async (orig) => ({
    ...(await orig<object>()),
    useMyGuildsQuery: () => ({ data: { guilds: hubsState.guilds }, isSuccess: hubsState.isSuccess }),
}));
vi.mock('../../../hooks/use-game-registry', () => ({
    useGameRegistry: () => ({ games: REGISTRY, isLoading: false, error: null }),
}));

const DAWN = myHub(10, 'Dawn', FOREVER.id);
const OLD_GUARD = myHub(20, 'Old Guard', CLASSIC.id);

/** Renders the picker the way the LFG page does: context from the route + `?hub`. */
function Page(): JSX.Element {
    const { gameSlug = '' } = useParams();
    const location = useLocation();
    const hubId = parseHubParam(new URLSearchParams(location.search).get('hub'));
    return (
        <>
            <LfgHubPicker gameId={1} gameSlug={gameSlug} groupKey="" hubId={hubId} />
            <output data-testid="url">{location.pathname + location.search}</output>
        </>
    );
}

function renderAt(url: string): void {
    render(
        <MemoryRouter initialEntries={[url]}>
            <Routes><Route path="/lfg/:gameSlug" element={<Page />} /></Routes>
        </MemoryRouter>,
    );
}

const url = (): string | null => screen.getByTestId('url').textContent;
const picker = (): HTMLSelectElement => screen.getByRole('combobox', { name: 'Hub' });

beforeEach(() => {
    hubsState.guilds = [DAWN, OLD_GUARD, myHub(30, 'Vikings', VALHEIM.id)];
    hubsState.isSuccess = true;
});
afterEach(() => window.localStorage.clear());

describe('LfgHubPicker', () => {
    it('lists every WoW hub as "<hub> · <variant>" and no other game', () => {
        renderAt('/lfg/world-of-warcraft-forever');
        const labels = Array.from(picker().options).map((o) => o.textContent);
        expect(labels).toEqual(['All of WoW: Forever', 'Dawn · WoW: Forever', 'Old Guard · World of Warcraft Classic']);
        expect(picker().value).toBe('all');
    });

    it('renders nothing for a viewer with no WoW hubs, or before the hubs load', () => {
        hubsState.guilds = [myHub(30, 'Vikings', VALHEIM.id)];
        renderAt('/lfg/world-of-warcraft-forever');
        expect(screen.queryByTestId('lfg-hub-picker')).toBeNull();
    });

    it('picking another variant opens that variant with ?hub and remembers it', () => {
        renderAt('/lfg/world-of-warcraft-forever');
        fireEvent.change(picker(), { target: { value: '20' } });
        expect(url()).toBe('/lfg/world-of-warcraft-classic?hub=20');
        expect(window.localStorage.getItem(LAST_HUB_STORAGE_KEY)).toBe('20');
        expect(picker().value).toBe('20');
    });

    it('with ?hub shows "from <hub>" and a link back to the hub', () => {
        renderAt('/lfg/world-of-warcraft-forever?hub=10');
        expect(picker().value).toBe('10');
        expect(screen.getByText('from Dawn')).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Back to Dawn' })).toHaveAttribute('href', '/hubs/10');
    });

    it('ignores a ?hub of another game ("Pick a hub", no chip)', () => {
        renderAt('/lfg/world-of-warcraft-forever?hub=20');
        expect(picker().value).toBe('');
        expect(picker().options[0]?.textContent).toBe('Pick a hub');
        expect(screen.queryByText(/^from /)).toBeNull();
    });

    it('pre-selects the remembered hub when the page opens without ?hub (URL wins otherwise)', () => {
        window.localStorage.setItem(LAST_HUB_STORAGE_KEY, '10');
        renderAt('/lfg/world-of-warcraft-forever');
        expect(url()).toBe('/lfg/world-of-warcraft-forever?hub=10');
    });

    it('does not override an explicit ?hub with the remembered one', () => {
        window.localStorage.setItem(LAST_HUB_STORAGE_KEY, '10');
        renderAt('/lfg/world-of-warcraft-forever?hub=20');
        expect(url()).toBe('/lfg/world-of-warcraft-forever?hub=20');
    });

    it('"All of <variant>" drops ?hub and forgets the pick', () => {
        window.localStorage.setItem(LAST_HUB_STORAGE_KEY, '10');
        renderAt('/lfg/world-of-warcraft-forever?hub=10');
        fireEvent.change(picker(), { target: { value: 'all' } });
        expect(url()).toBe('/lfg/world-of-warcraft-forever');
        expect(window.localStorage.getItem(LAST_HUB_STORAGE_KEY)).toBeNull();
    });

    it('still picks with blocked storage', () => {
        const restore = blockWebStorage();
        try {
            renderAt('/lfg/world-of-warcraft-forever');
            fireEvent.change(picker(), { target: { value: '10' } });
            expect(url()).toBe('/lfg/world-of-warcraft-forever?hub=10');
        } finally {
            restore();
        }
    });
});

describe('LfgHubPicker loading', () => {
    it('renders nothing until the hubs query settles', () => {
        hubsState.isSuccess = false;
        renderAt('/lfg/world-of-warcraft-forever');
        expect(screen.queryByTestId('lfg-hub-picker')).toBeNull();
    });
});
