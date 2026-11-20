/**
 * ROK-2099 — ruling 9's plugin gate (the Admin → General row and the page exist
 * only while `blizzard` is active) and the page's failed-list state.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, renderHook, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { CORE_PLUGIN_ID } from '@raid-ledger/contract';
import { usePluginStore } from '../../../stores/plugin-store';
import { AddonErrorsPage } from './addon-errors-page';
import { ADDON_ERRORS_NAV_ITEMS, ADDON_ERRORS_PATH, ADDON_ERRORS_PLUGIN } from './addon-errors-route';
import { registerPlugin } from '../../plugin-registry';
import { useAdminGeneralNavItems } from '../../admin-nav-items';
import { EMPTY_TEXT } from './addon-errors-table';

const list = vi.hoisted(() => ({ isError: false }));
vi.mock('../../../hooks/use-media-query', () => ({ useMediaQuery: () => true }));
vi.mock('./addon-errors-toolbar', () => ({ AddonErrorsToolbar: () => null }));
vi.mock('./use-addon-errors', () => ({
    useAddonErrorGroups: () => ({
        data: list.isError ? undefined : { items: [], total: 0, page: 1, pageSize: 25 },
        isPending: false, isError: list.isError, isPlaceholderData: false,
    }),
    useAddonErrorsExport: () => ({ busy: null, run: vi.fn() }),
}));

function setBlizzard(active: boolean): void {
    usePluginStore.setState({
        activeSlugs: new Set([CORE_PLUGIN_ID, ...(active ? ['blizzard'] : [])]), initialized: true, settled: true,
    });
}

function renderPage(): void {
    render(
        <MemoryRouter initialEntries={[ADDON_ERRORS_PATH]}>
            <Routes>
                <Route path={ADDON_ERRORS_PATH} element={<AddonErrorsPage />} />
                <Route path="/admin/settings/general" element={<p>General settings</p>} />
            </Routes>
        </MemoryRouter>,
    );
}

describe('Addon errors plugin gate (ROK-2099 ruling 9)', () => {
    beforeAll(() => {
        registerPlugin(ADDON_ERRORS_PLUGIN, { icon: '/x.svg', color: 'blue', label: 'WoW' }).registerAdminGeneralNavItems(ADDON_ERRORS_NAV_ITEMS);
    });
    beforeEach(() => { list.isError = false; });
    afterEach(() => { usePluginStore.setState({ activeSlugs: new Set([CORE_PLUGIN_ID]), initialized: false, settled: false }); });

    it('adds no Admin → General row while blizzard is inactive', () => {
        setBlizzard(false);
        expect(renderHook(() => useAdminGeneralNavItems()).result.current).toEqual([]);
    });

    it('adds the Addon errors row while blizzard is active', () => {
        setBlizzard(true);
        expect(renderHook(() => useAdminGeneralNavItems()).result.current).toEqual([{ to: ADDON_ERRORS_PATH, label: 'Addon errors' }]);
    });

    it('redirects to General while blizzard is inactive', () => {
        setBlizzard(false);
        renderPage();
        expect(screen.getByText('General settings')).toBeInTheDocument();
        expect(screen.queryByRole('heading', { name: 'Addon errors' })).toBeNull();
    });

    it('renders the page while blizzard is active', () => {
        setBlizzard(true);
        renderPage();
        expect(screen.getByRole('heading', { name: 'Addon errors' })).toBeInTheDocument();
        expect(screen.getByText(EMPTY_TEXT)).toBeInTheDocument();
    });

    it('a failed list shows only the error, not the "no errors yet" sentence', () => {
        setBlizzard(true);
        list.isError = true;
        renderPage();
        expect(screen.getByText('Could not load addon errors.')).toBeInTheDocument();
        expect(screen.queryByText(EMPTY_TEXT)).toBeNull();
    });
});
