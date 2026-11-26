/**
 * ROK-2358 — a plugin page on a core route mounts only while its plugin is
 * active; otherwise the route shows Page not found (or the given fallback).
 */
import type { JSX } from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { CORE_PLUGIN_ID } from '@raid-ledger/contract';
import { server } from '../../test/mocks/server';
import { renderWithProviders } from '../../test/render-helpers';
import { usePluginStore } from '../../stores/plugin-store';
import { NOT_FOUND_TITLE } from '../../pages/not-found-page';
import { PluginRoute } from './plugin-route';

const API_BASE = 'http://localhost:3000';

function setPlugins(active: string[], settled = true): void {
    usePluginStore.setState({
        activeSlugs: new Set([CORE_PLUGIN_ID, ...active]),
        initialized: settled,
        settled,
    });
}

function renderRoute(fallback?: JSX.Element) {
    return renderWithProviders(
        <PluginRoute slug="valheim" {...(fallback ? { fallback } : {})}>
            <p>Valheim page body</p>
        </PluginRoute>,
    );
}

describe('PluginRoute (ROK-2358)', () => {
    beforeEach(() => setPlugins([], false));

    it('renders the plugin page while its plugin is active', () => {
        setPlugins(['valheim']);
        renderRoute();
        expect(screen.getByText('Valheim page body')).toBeInTheDocument();
        expect(screen.queryByText(NOT_FOUND_TITLE)).not.toBeInTheDocument();
    });

    it('shows Page not found and never mounts the page while its plugin is off', () => {
        setPlugins(['blizzard']);
        renderRoute();
        expect(screen.getByText(NOT_FOUND_TITLE)).toBeInTheDocument();
        expect(screen.queryByText('Valheim page body')).not.toBeInTheDocument();
    });

    it('shows the given fallback instead of Page not found while its plugin is off', () => {
        setPlugins([]);
        renderRoute(<p>Plugin off fallback</p>);
        expect(screen.getByText('Plugin off fallback')).toBeInTheDocument();
        expect(screen.queryByText(NOT_FOUND_TITLE)).not.toBeInTheDocument();
        expect(screen.queryByText('Valheim page body')).not.toBeInTheDocument();
    });

    it('renders neither the page nor not-found until the plugin list settles', () => {
        server.use(http.get(`${API_BASE}/system/status`, () =>
            HttpResponse.json({ status: 'ok', claimRequired: false, activePlugins: ['valheim'] })));
        renderRoute();
        expect(screen.queryByText('Valheim page body')).not.toBeInTheDocument();
        expect(screen.queryByText(NOT_FOUND_TITLE)).not.toBeInTheDocument();
    });

    it('treats a failed plugin-list request as settled with the plugin off', async () => {
        server.use(http.get(`${API_BASE}/system/status`, () =>
            HttpResponse.json({ message: 'down' }, { status: 500 })));
        renderRoute();
        expect(await screen.findByText(NOT_FOUND_TITLE)).toBeInTheDocument();
        expect(screen.queryByText('Valheim page body')).not.toBeInTheDocument();
    });
});
