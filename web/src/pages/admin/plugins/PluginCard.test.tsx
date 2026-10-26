import { describe, it, expect, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { emptyPluginHubManifest, type PluginInfoDto } from '@raid-ledger/contract';
import { renderWithProviders } from '../../../test/render-helpers';
import { PluginCard } from './PluginCard';
import { PELICAN_SERVER_ROWS_URL } from './plugin-setup-row-body';
import { VALHEIM_TWO_LEFT, corePluginInfo, makePluginInfo, valheimPluginInfo } from '../../../test/factories/plugin-info';

const basePlugin: PluginInfoDto = {
    slug: 'blizzard',
    name: 'Blizzard Plugin',
    version: '1.2.0',
    description: 'Adds WoW character import and realm data',
    author: { name: 'Author' },
    builtIn: false,
    hub: emptyPluginHubManifest(),
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

function renderPlugin(plugin: PluginInfoDto): void {
    renderWithProviders(<PluginCard plugin={plugin} {...handlers} isPending={false} />);
}

function setupBlock(): HTMLElement {
    return screen.getByTestId('plugin-setup');
}

/** ROK-1969 §5.4 W7–W9 — Core card and the "Adds to hubs" block. */
describe('admin plugins PluginCard — hub contributions', () => {
    it('W7: the Core card shows "Always on" and no lifecycle buttons', () => {
        renderPlugin(corePluginInfo());
        expect(screen.getByText('Always on')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /^(Install|Activate|Deactivate|Uninstall)$/ })).toBeNull();
        expect(screen.queryByText('Active')).toBeNull();
        expect(screen.getByText('Built in — cannot be deactivated or uninstalled.')).toBeInTheDocument();
    });

    it('W7: Core lists its shared widgets, including Gallery, and needs no setup', () => {
        renderPlugin(corePluginInfo());
        const widgets = screen.getByRole('list', { name: 'Widgets' });
        expect(within(widgets).getByText('Gallery')).toBeInTheDocument();
        expect(within(setupBlock()).getByText('No setup needed')).toBeInTheDocument();
    });

    it('W8: the Valheim card lists Characters, Map, Materials and Planner tabs and the Deaths widget — not Gallery', () => {
        renderPlugin(valheimPluginInfo());
        const tabs = screen.getByRole('list', { name: 'Tabs' });
        for (const label of ['Characters', 'Map', 'Materials', 'Planner']) {
            expect(within(tabs).getByText(label)).toBeInTheDocument();
        }
        const widgets = screen.getByRole('list', { name: 'Widgets' });
        expect(within(widgets).getByText('Deaths')).toBeInTheDocument();
        expect(within(widgets).queryByText('Gallery')).toBeNull();
    });

    it('W9: a plugin with an empty hub renders no "Adds to hubs" heading', () => {
        renderPlugin(makePluginInfo());
        expect(screen.queryByRole('heading', { name: 'Adds to hubs' })).toBeNull();
        expect(within(setupBlock()).getByText('No setup needed')).toBeInTheDocument();
    });
});

/** ROK-1969 §3.5 — the setup checklist (operator rulings 2026-10-26). */
describe('admin plugins PluginCard — setup checklist', () => {
    it('the summary chip counts only required unmet steps and opens the checklist', () => {
        renderPlugin(valheimPluginInfo(VALHEIM_TWO_LEFT));
        const chips = screen.getAllByText('2 steps left');
        expect(chips).toHaveLength(2);
        chips.forEach((c) => expect(c).toHaveAttribute('data-tone', 'warning'));
        expect(setupBlock()).toHaveAttribute('open');
        expect(within(setupBlock()).getByText('1 of 3 required done · 2 optional')).toBeInTheDocument();
    });

    it('optional unmet rows never count — every required row met reads "Ready" and stays closed', () => {
        const allRequiredMet = VALHEIM_TWO_LEFT.map((s) =>
            ['pelican-server', 'link-mod', 'link-token'].includes(s.id) ? { id: s.id, state: 'met' as const } : { id: s.id, state: 'unmet' as const });
        renderPlugin(valheimPluginInfo(allRequiredMet));
        expect(screen.getAllByText('Ready')[0]).toHaveAttribute('data-tone', 'success');
        expect(setupBlock()).not.toHaveAttribute('open');
    });

    it('unknown rows are neutral: "Manual step" without a check, "Not checked" when the check has not run', () => {
        renderPlugin(valheimPluginInfo());
        const manual = within(setupBlock()).getAllByText('Manual step');
        const unchecked = within(setupBlock()).getAllByText('Not checked');
        expect(manual).toHaveLength(2);
        expect(unchecked).toHaveLength(3);
        [...manual, ...unchecked].forEach((c) => expect(c).toHaveAttribute('data-tone', 'neutral'));
        expect(screen.getAllByText('Check setup')[0]).toHaveAttribute('data-tone', 'neutral');
    });

    it('unmet steps never block activation', () => {
        renderPlugin({ ...valheimPluginInfo(VALHEIM_TWO_LEFT), status: 'inactive' });
        expect(screen.getByRole('button', { name: 'Activate' })).toBeEnabled();
    });

    it('rows with Pelican hints carry a disabled "Apply on Pelican" button with a coming-later line', () => {
        renderPlugin(valheimPluginInfo(VALHEIM_TWO_LEFT));
        const apply = screen.getAllByRole('button', { name: 'Apply on Pelican', hidden: true });
        expect(apply).toHaveLength(3);
        apply.forEach((b) => expect(b).toBeDisabled());
        expect(screen.getAllByText(/Coming later/)).toHaveLength(3);
    });

    it('the mod-token row shows placeholders only and links "Issue token…" to the Pelican server row', () => {
        renderPlugin(valheimPluginInfo(VALHEIM_TWO_LEFT));
        const row = screen.getByTestId('setup-row-link-token');
        expect(within(row).getByText('The value is issued in Raid Ledger and never shown here.')).toBeInTheDocument();
        expect(within(row).getByRole('link', { name: 'Issue token…', hidden: true })).toHaveAttribute('href', PELICAN_SERVER_ROWS_URL);
        expect(within(row).getByTestId('setup-secret').textContent).toMatch(/<[^>]*shown once[^>]*>/);
        expect(row.querySelector('details')).toHaveAttribute('open');
    });
});
