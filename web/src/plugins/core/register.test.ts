/** ROK-1969 D6 — the built-in Core plugin owns the shared hub Gallery card (moved from Valheim). */
import { describe, it, expect } from 'vitest';
import { CORE_PLUGIN_ID, type GuildPage } from '@raid-ledger/contract';
import { gatedHubGameWidgets, getHubGameWidgetRegistrations } from '../hub-game-widgets';
import { getPluginBadge } from '../plugin-registry';
import './register';
import '../valheim/register';

describe('core register — Overview Gallery widget (ROK-1942 D10, moved by ROK-1969 D6, widened by ROK-1965 D14)', () => {
    it('registers a lazy, members-only, default-on `gallery` card (span 2) right after Deaths, owned by core', () => {
        const reg = getHubGameWidgetRegistrations().find((r) => r.pluginSlug === CORE_PLUGIN_ID && r.widget.id === 'gallery');
        expect(reg?.widget.title).toBe('Gallery');
        expect(reg?.widget.audience).toBe('members');
        expect(reg?.widget.description).toBe('Pictures from this hub — Discord posts and member uploads.');
        // ROK-1965 D14/OQ1: offered on every hub — no game or hub-kind scope.
        expect(reg?.widget).not.toHaveProperty('kinds');
        expect(reg?.widget).not.toHaveProperty('games');
        expect(reg?.widget.order).toBe(47);
        expect(reg?.widget.span).toBe(2);
        expect(reg?.widget.defaultOn).toBe(true);
        expect(reg?.widget.action?.name).toBe('HubGallerySeeAll');
        expect(reg?.widget.useVisible?.name).toBe('useGalleryWidgetVisible');
    });

    it('the Valheim plugin no longer registers a Gallery of its own', () => {
        const owners = getHubGameWidgetRegistrations().filter((r) => r.widget.id === 'gallery').map((r) => r.pluginSlug);
        expect(owners).toEqual([CORE_PLUGIN_ID]);
    });

    it('registers a "Core" badge, so arrange mode labels plugin:core:* as Core', () => {
        expect(getPluginBadge(CORE_PLUGIN_ID)?.label).toBe('Core');
    });
});

describe('core register — Steam Achievement race + Playtime (ROK-1953 W7, W8)', () => {
    const steam = (id: string) =>
        getHubGameWidgetRegistrations().find((r) => r.pluginSlug === CORE_PLUGIN_ID && r.widget.id === id);

    it.each([
        ['steam-achievements', 'Achievement race', 50, 'useSteamAchievementsVisible', /Hidden ones stay hidden/],
        ['steam-playtime', 'Playtime', 52, 'useSteamPlaytimeVisible', /Lifetime Steam hours/],
    ] as const)('W7 — %s: owned by core, every game, community + server hubs, members, span 1', (id, title, order, visible, desc) => {
        const reg = steam(id);
        expect(reg?.pluginSlug).toBe(CORE_PLUGIN_ID);
        expect(reg?.widget.title).toBe(title);
        expect(reg?.widget.description).toMatch(desc);
        expect(reg?.widget.games).toBeUndefined();
        expect(reg?.widget.kinds).toEqual(['game_community', 'game_server']);
        expect(reg?.widget.audience).toBe('members');
        expect(reg?.widget.span).toBe(1);
        expect(reg?.widget.order).toBe(order);
        expect(reg?.widget.defaultOn).toBe(true);
        expect(reg?.widget.useVisible?.name).toBe(visible);
    });

    const page = (kind: GuildPage['guild']['kind'], gameSlug: string | undefined, role: GuildPage['viewer']['role'] = 'member'): GuildPage => ({
        guild: { id: 5, kind, ...(gameSlug === undefined ? {} : { gameSlug }) },
        viewer: { role, canEdit: false, canManageEditors: false },
    }) as GuildPage;
    const steamIds = (p: GuildPage): string[] =>
        gatedHubGameWidgets(p, new Set()).filter((r) => r.widget.id.startsWith('steam-')).map((r) => r.widget.id);

    it('W8 — offered on community + server hubs of any game, never on a WoW guild, a game-less hub or to visitors', () => {
        expect(steamIds(page('game_community', 'baldurs-gate-3'))).toEqual(['steam-achievements', 'steam-playtime']);
        expect(steamIds(page('game_server', 'satisfactory'))).toEqual(['steam-achievements', 'steam-playtime']);
        expect(steamIds(page('wow_guild', 'world-of-warcraft'))).toEqual([]);
        expect(steamIds(page('game_community', undefined))).toEqual([]);
        expect(steamIds(page('game_community', 'baldurs-gate-3', 'visitor'))).toEqual([]);
    });
});
