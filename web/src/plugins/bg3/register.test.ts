/** ROK-1958 D-3 — the Campaign tab shows only where the bg3 campaign routes answer: `game_community` hubs. */
import { describe, expect, it } from 'vitest';
import { BG3_GAME_SLUG, type GuildPage } from '@raid-ledger/contract';
import type { HubCtx } from '../hub-module';
import { hubGameTabs } from '../hub-game-tabs';
import { usePluginStore } from '../../stores/plugin-store';
import './register';

function ctx(kind: GuildPage['guild']['kind']): HubCtx {
    const guild: GuildPage['guild'] = {
        id: 9, gameId: 3, kind, name: 'Hub', region: 'server', realmSlug: null, realmName: null,
        faction: null, memberCount: 1, lastSnapshotAt: null, gameSlug: BG3_GAME_SLUG,
    };
    const viewer: GuildPage['viewer'] = { role: 'member', canEdit: false, canManageEditors: false };
    const page: GuildPage = { guild, importedBy: null, viewer, ranks: [], roleCounts: { tank: 0, healer: 0, dps: 0, unknown: 0 } };
    // The gate reads only `page`; `raids` is never touched (hub-tabs.test idiom).
    return { page } as HubCtx;
}

const campaignTabShown = (c: HubCtx): boolean =>
    hubGameTabs().some((t) => t.id === 'campaign' && (t.visible?.(c) ?? true));

describe('bg3 register — Campaign tab', () => {
    it('shows on a BG3 community hub', () => {
        usePluginStore.getState().setActiveSlugs(['bg3']);
        expect(campaignTabShown(ctx('game_community'))).toBe(true);
    });

    it('hides on a BG3 game_server hub, where every campaign route is refused', () => {
        usePluginStore.getState().setActiveSlugs(['bg3', 'pelican']);
        expect(campaignTabShown(ctx('game_server'))).toBe(false);
    });
});
