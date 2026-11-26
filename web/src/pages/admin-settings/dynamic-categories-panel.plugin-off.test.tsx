/**
 * ROK-2363 — the dynamic-categories panel belongs to the AI plugin. While `ai`
 * is off it renders nothing and fires no `/admin/ai/*` or discovery-category
 * request (they 403 with the plugin off); while `ai` is on it loads as before.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { CORE_PLUGIN_ID } from '@raid-ledger/contract';
import { server } from '../../test/mocks/server';
import { renderWithProviders } from '../../test/render-helpers';
import { usePluginStore } from '../../stores/plugin-store';
import { DynamicCategoriesPanel } from './dynamic-categories-panel';

const API_BASE = 'http://localhost:3000';

vi.mock('../../hooks/use-auth', () => ({
    getAuthToken: () => 'test-token',
    useAuth: () => ({ user: { id: 1, username: 'admin', role: 'admin' } }),
    isAdmin: (user: { role?: string } | null | undefined) => user?.role === 'admin',
}));

const requests: string[] = [];

function setPlugins(active: string[]): void {
    usePluginStore.setState({ activeSlugs: new Set([CORE_PLUGIN_ID, ...active]), initialized: true, settled: true });
}

beforeEach(() => {
    requests.length = 0;
    server.use(
        http.get(`${API_BASE}/admin/ai/features`, () => {
            requests.push('/admin/ai/features');
            return HttpResponse.json({ chatEnabled: false, dynamicCategoriesEnabled: true });
        }),
        http.get(`${API_BASE}/admin/discovery-categories`, () => {
            requests.push('/admin/discovery-categories');
            return HttpResponse.json({ suggestions: [] });
        }),
    );
});

describe('DynamicCategoriesPanel — AI plugin gate (ROK-2363)', () => {
    it('loads and renders the panel while the AI plugin is active', async () => {
        setPlugins(['ai']);
        renderWithProviders(<DynamicCategoriesPanel />);
        expect(await screen.findByRole('heading', { name: /dynamic categories/i })).toBeInTheDocument();
        expect(requests).toContain('/admin/ai/features');
    });

    it('renders nothing and makes no AI or category request while the AI plugin is off', async () => {
        setPlugins([]);
        const { container } = renderWithProviders(<DynamicCategoriesPanel />);
        await new Promise((r) => setTimeout(r, 50));
        expect(container).toBeEmptyDOMElement();
        expect(requests).toEqual([]);
    });
});
