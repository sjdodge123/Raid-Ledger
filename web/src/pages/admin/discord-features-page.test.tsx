/**
 * ROK-1652 (E10): the Discord features page — Quick Play is the shared Switch,
 * and every callout and link on the page (plus the LFG board's
 * missing-permission warning) wears the semantic tokens, never a raw hue.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { usePluginStore } from '../../stores/plugin-store';
import { DiscordFeaturesPage } from './discord-features-page';

const admin = {
    discordBotStatus: { data: { connected: true } as { connected: boolean } | undefined },
    adHocEventsStatus: { data: { enabled: false } as { enabled: boolean } | undefined },
    updateAdHocEvents: { mutate: vi.fn(), isPending: false },
};
vi.mock('../../hooks/use-admin-settings', () => ({ useAdminSettings: () => admin }));

const lfg = {
    status: { data: { enabled: false } },
    update: { mutate: vi.fn(), isPending: false },
};
vi.mock('../../hooks/admin/use-lfg-board-settings', () => ({
    useLfgBoardSettings: () => lfg,
    useLfgIndicatorEmoji: () => ({ mutate: vi.fn(), isPending: false }),
}));

// Sibling sections owned by other lanes — stubbed so this file tests this page.
vi.mock('./ephemeral-voice-section', () => ({ EphemeralVoiceSection: () => null }));
vi.mock('./weekly-digest-section', () => ({ WeeklyDigestSection: () => null }));
vi.mock('../../lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const RAW_HUE = /\b(?:bg|text|border|ring)-(?:emerald|amber|red|blue|purple|slate)-\d{2,3}/;

const renderPage = () =>
    render(
        <MemoryRouter>
            <DiscordFeaturesPage />
        </MemoryRouter>,
    );

const quickPlay = () => screen.getByRole('switch', { name: 'Enable Quick Play Events' });

beforeEach(() => {
    vi.clearAllMocks();
    usePluginStore.getState().setActiveSlugs(['discord']);
    admin.discordBotStatus.data = { connected: true };
    admin.adHocEventsStatus.data = { enabled: false };
    admin.updateAdHocEvents.isPending = false;
    admin.updateAdHocEvents.mutate = vi.fn();
    lfg.update.mutate = vi.fn();
});

describe('DiscordFeaturesPage — Quick Play switch (ROK-1652 AC2)', () => {
    it('is a switch named "Enable Quick Play Events" reading off when the setting is off', () => {
        renderPage();
        expect(quickPlay()).toHaveAttribute('aria-checked', 'false');
    });

    it('reads on when the setting is on', () => {
        admin.adHocEventsStatus.data = { enabled: true };
        renderPage();
        expect(quickPlay()).toHaveAttribute('aria-checked', 'true');
    });

    it('turns Quick Play on with the flipped value', () => {
        renderPage();
        fireEvent.click(quickPlay());
        expect(admin.updateAdHocEvents.mutate).toHaveBeenCalledWith({ enabled: true }, expect.any(Object));
    });

    it('turns Quick Play off with the flipped value', () => {
        admin.adHocEventsStatus.data = { enabled: true };
        renderPage();
        fireEvent.click(quickPlay());
        expect(admin.updateAdHocEvents.mutate).toHaveBeenCalledWith({ enabled: false }, expect.any(Object));
    });

    it('is disabled and swallows the press while the write is pending', () => {
        admin.updateAdHocEvents.isPending = true;
        renderPage();
        expect(quickPlay()).toBeDisabled();
        fireEvent.click(quickPlay());
        expect(admin.updateAdHocEvents.mutate).not.toHaveBeenCalled();
    });
});

describe('DiscordFeaturesPage — tokens, not raw hues (ROK-1652 ruling 9)', () => {
    it('paints the bot-not-connected callout with the warning tokens', () => {
        admin.discordBotStatus.data = { connected: false };
        renderPage();
        const text = screen.getByText(/The Discord bot must be connected/);
        expect(text).toHaveClass('text-warning');
        expect(text.parentElement).toHaveClass('bg-warning/10', 'border-warning/30');
    });

    it('colours the Channels link with the success token', () => {
        renderPage();
        expect(screen.getByRole('link', { name: 'Channels' })).toHaveClass('text-success');
    });

    it('colours the Manage Plugins link with the success token when the plugin is off', () => {
        usePluginStore.getState().setActiveSlugs([]);
        renderPage();
        expect(screen.getByRole('link', { name: 'Manage Plugins' })).toHaveClass('text-success');
    });

    it('paints the LFG board missing-permission warning with the warning tokens', () => {
        lfg.update.mutate = vi.fn((_vars, opts) =>
            opts?.onSuccess?.({ enabled: true, warning: { missing: ['Manage Threads'] } }),
        );
        renderPage();
        fireEvent.click(screen.getByRole('switch', { name: 'Enable LFG board' }));
        const warning = screen.getByTestId('lfg-board-warning');
        expect(warning).toHaveClass('bg-warning/10', 'border-warning/30');
        expect(screen.getByText(/Saved, but the bot is missing/)).toHaveClass('text-warning');
        expect(screen.getByText('Manage Threads').parentElement).toHaveClass('text-warning');
        expect(warning.innerHTML).not.toMatch(RAW_HUE);
    });

    it.each([
        ['bot connected', true],
        ['bot not connected', false],
    ])('renders no raw emerald/amber hue (%s)', (_label, connected) => {
        admin.discordBotStatus.data = { connected };
        const { container } = renderPage();
        expect(container.innerHTML).not.toMatch(RAW_HUE);
    });
});
