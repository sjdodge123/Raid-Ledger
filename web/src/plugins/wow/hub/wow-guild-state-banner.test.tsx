/**
 * ROK-1170 AC5 — the disbanded-guild banner under the WoW hero: only for
 * `blizzardGuild.state === 'disbanded'`, the ruled copy for everyone, and the
 * "Update the guild path" action only for an editor who can open hub settings.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { BlizzardGuildState, GuildPage } from '@raid-ledger/contract';
import type { HubCtx } from '../../hub-module';
import { HubSettingsProvider } from '../../../components/hub/settings/hub-settings-context';
import { WowGuildStateBanner } from './wow-guild-state-banner';

const COPY = 'Blizzard no longer finds this guild — it may have been disbanded or renamed in game';
const ACTION = { name: 'Update the guild path' };

type Viewer = GuildPage['viewer'];
const MEMBER: Viewer = { role: 'member', canEdit: false, canManageEditors: false };
const LEADER: Viewer = { role: 'leader', canEdit: true, canManageEditors: true };

function ctx(state: BlizzardGuildState | null | 'absent', viewer: Viewer = MEMBER): HubCtx {
    const summary = state === 'absent' ? {} : { blizzardGuild: { foundedAt: null, state } };
    const page: GuildPage = {
        guild: { id: 7, gameId: 3, kind: 'wow_guild', name: 'Iron Vanguard', region: 'us', realmSlug: null, realmName: 'Doomhowl', faction: null, memberCount: 3, lastSnapshotAt: null, ...summary },
        importedBy: null,
        viewer,
        ranks: [],
        roleCounts: { tank: 0, healer: 0, dps: 0, unknown: 0 },
    };
    return { page } as HubCtx;
}

function renderWithSettings(value: HubCtx, openSettings: (() => void) | null): void {
    render(<HubSettingsProvider value={{ openChannelPicker: null, openSettings }}><WowGuildStateBanner {...value} /></HubSettingsProvider>);
}

describe('WowGuildStateBanner (ROK-1170)', () => {
    it.each(['ok', 'not_found', 'error', null, 'absent'] as const)('renders nothing for state %s', (state) => {
        const { container } = render(<WowGuildStateBanner {...ctx(state, LEADER)} />);
        expect(container).toBeEmptyDOMElement();
    });

    it('shows a member the ruled copy as a persistent warning status, with no action', () => {
        renderWithSettings(ctx('disbanded'), null);
        const banner = screen.getByTestId('wow-guild-state-banner');
        expect(banner).toHaveAttribute('role', 'status');
        expect(banner).toHaveClass('bg-warning/10', 'border-warning/30', 'text-warning');
        expect(banner).toHaveTextContent(COPY);
        expect(screen.queryByRole('button', ACTION)).not.toBeInTheDocument();
    });

    it('gives an editor the same copy plus "Update the guild path", which opens hub settings', async () => {
        const openSettings = vi.fn();
        renderWithSettings(ctx('disbanded', LEADER), openSettings);
        expect(screen.getByTestId('wow-guild-state-banner')).toHaveTextContent(COPY);
        await userEvent.click(screen.getByRole('button', ACTION));
        expect(openSettings).toHaveBeenCalledTimes(1);
    });

    it('hides the action from an editor who cannot open hub settings (delegated page editor)', () => {
        renderWithSettings(ctx('disbanded', { role: 'officer', canEdit: true, canManageEditors: false }), null);
        expect(screen.getByTestId('wow-guild-state-banner')).toHaveTextContent(COPY);
        expect(screen.queryByRole('button', ACTION)).not.toBeInTheDocument();
    });
});
