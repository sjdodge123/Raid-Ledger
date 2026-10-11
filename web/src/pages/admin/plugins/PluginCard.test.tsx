import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import type { PluginInfoDto } from '@raid-ledger/contract';
import { renderWithProviders } from '../../../test/render-helpers';
import { PluginCard } from './PluginCard';

const basePlugin: PluginInfoDto = {
    slug: 'blizzard',
    name: 'Blizzard Plugin',
    version: '1.2.0',
    description: 'Adds WoW character import and realm data',
    author: { name: 'Author' },
    gameSlugs: ['world-of-warcraft'],
    capabilities: ['character-sync'],
    integrations: [],
    status: 'active',
    installedAt: new Date().toISOString(),
};

const handlers = { onInstall: vi.fn(), onUninstall: vi.fn(), onActivate: vi.fn(), onDeactivate: vi.fn() };

function renderCard(url: string): void {
    renderWithProviders(
        <PluginCard plugin={{ ...basePlugin, author: { name: 'Author', url } }} {...handlers} isPending={false} />,
    );
}

/** The live /admin/plugins card (ROK-1757 item 11): author links are http(s) only. */
describe('admin plugins PluginCard author link', () => {
    it('links an https author URL', () => {
        renderCard('https://example.com');
        expect(screen.getByRole('link', { name: 'Author' })).toHaveAttribute('href', 'https://example.com');
    });

    it.each(['data:text/html,<script>alert(1)</script>', 'javascript:alert(1)', '/relative'])(
        'renders the author as plain text for a non-http(s) URL: %s',
        (url) => {
            renderCard(url);
            expect(screen.queryByRole('link', { name: 'Author' })).toBeNull();
            expect(screen.getByText('Author')).toBeInTheDocument();
        },
    );
});
