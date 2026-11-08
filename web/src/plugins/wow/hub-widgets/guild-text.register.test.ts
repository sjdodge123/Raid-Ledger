/** ROK-2136 AC11/AC12 — the "Guild message" widget's gating: Forever `wow_guild` hubs, members only, plugin active. */
import { afterEach, describe, expect, it } from 'vitest';
import type { GuildPage } from '@raid-ledger/contract';
import { gatedHubGameWidgets } from '../../hub-game-widgets';
import { clearRegistry, registerPlugin } from '../../plugin-registry';
import { WOW_FOREVER_GAME_SLUG } from '../lib/forever-identity';
import { guildTextWidget } from './guild-text.register';

type Role = GuildPage['viewer']['role'];
type Kind = GuildPage['guild']['kind'];
const BADGE = { icon: '/x.png', color: 'blue', label: 'WoW' };

function page(role: Role, kind: Kind = 'wow_guild', gameSlug = WOW_FOREVER_GAME_SLUG): GuildPage {
    return {
        guild: { id: 7, kind, gameSlug },
        viewer: { role, canEdit: false, canManageEditors: false },
    } as GuildPage;
}

function ids(p: GuildPage, active: ReadonlySet<string> = new Set(['blizzard'])): string[] {
    return gatedHubGameWidgets(p, active).map((r) => r.widget.id);
}

afterEach(() => { clearRegistry(); });

describe('guildTextWidget gating', () => {
    it('declares the approved id, title, order and span (OQ-1)', () => {
        expect(guildTextWidget).toMatchObject({ id: 'forever-guild-text', title: 'Guild message', order: 12, span: 1, audience: 'members' });
    });

    it('shows on a Forever wow_guild hub to a member, never to a visitor', () => {
        registerPlugin('blizzard', BADGE).registerHubWidget(guildTextWidget);
        expect(ids(page('member'))).toContain('forever-guild-text');
        expect(ids(page('visitor'))).not.toContain('forever-guild-text');
    });

    it('never shows on a non-Forever game or a non-wow_guild kind', () => {
        registerPlugin('blizzard', BADGE).registerHubWidget(guildTextWidget);
        expect(ids(page('member', 'wow_guild', 'world-of-warcraft-classic'))).not.toContain('forever-guild-text');
        expect(ids(page('member', 'game_community'))).not.toContain('forever-guild-text');
    });

    it('does not render while the blizzard plugin is inactive', () => {
        registerPlugin('blizzard', BADGE).registerHubWidget(guildTextWidget);
        expect(ids(page('member'), new Set())).not.toContain('forever-guild-text');
    });
});
