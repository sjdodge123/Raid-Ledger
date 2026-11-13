/** ROK-1789 A-D6 / AC10 — the Recruitment widget's declaration and gating: Forever `wow_guild` hubs, plugin active. */
import { afterEach, describe, expect, it } from 'vitest';
import type { GuildPage } from '@raid-ledger/contract';
import { WOW_CLASSIC_RECRUIT_CLASSES, WOW_RECRUIT_CLASSES } from '@raid-ledger/contract';
import { gatedHubGameWidgets } from '../../hub-game-widgets';
import { clearRegistry, registerPlugin } from '../../plugin-registry';
import { WOW_FOREVER_GAME_SLUG } from '../lib/forever-identity';
import { recruitmentWidget } from './recruitment.register';
import { recruitClassesFor, sortWanted } from './recruitment.helpers';

type Kind = GuildPage['guild']['kind'];
const BADGE = { icon: '/x.png', color: 'blue', label: 'WoW' };

function page(kind: Kind = 'wow_guild', gameSlug = WOW_FOREVER_GAME_SLUG): GuildPage {
    return { guild: { id: 7, kind, gameSlug }, viewer: { role: 'member', canEdit: false, canManageEditors: false } } as GuildPage;
}

function ids(p: GuildPage, active: ReadonlySet<string> = new Set(['blizzard'])): string[] {
    return gatedHubGameWidgets(p, active).map((r) => r.widget.id);
}

afterEach(() => { clearRegistry(); });

describe('recruitmentWidget gating', () => {
    it('declares the approved id, title, order and span (A-D6)', () => {
        expect(recruitmentWidget).toMatchObject({ id: 'forever-recruitment', title: 'Recruitment', order: 14, span: 1, audience: 'everyone' });
    });

    it('shows only on a Forever wow_guild hub with the plugin active (ruling A3)', () => {
        registerPlugin('blizzard', BADGE).registerHubWidget(recruitmentWidget);
        expect(ids(page())).toContain('forever-recruitment');
        expect(ids(page('wow_guild', 'world-of-warcraft-classic'))).not.toContain('forever-recruitment');
        expect(ids(page('game_community'))).not.toContain('forever-recruitment');
        expect(ids(page(), new Set())).not.toContain('forever-recruitment');
    });
});

describe('recruitment helpers', () => {
    it('offers the 9 Classic classes on Forever/Classic and all 13 on Retail (A-D7)', () => {
        expect(recruitClassesFor(WOW_FOREVER_GAME_SLUG)).toEqual(WOW_CLASSIC_RECRUIT_CLASSES);
        expect(recruitClassesFor('world-of-warcraft-classic')).toEqual(WOW_CLASSIC_RECRUIT_CLASSES);
        expect(recruitClassesFor('world-of-warcraft')).toEqual(WOW_RECRUIT_CLASSES);
    });

    it('sorts open → limited → closed and keeps editor order within a state, without mutating', () => {
        const wanted = [
            { className: 'Rogue' as const, role: 'dps' as const, state: 'closed' as const },
            { className: 'Mage' as const, role: 'dps' as const, state: 'open' as const },
            { className: 'Druid' as const, role: 'tank' as const, state: 'limited' as const },
            { className: 'Priest' as const, role: 'healer' as const, state: 'open' as const },
        ];
        expect(sortWanted(wanted).map((w) => w.className)).toEqual(['Mage', 'Priest', 'Druid', 'Rogue']);
        expect(wanted[0]?.className).toBe('Rogue');
    });
});
