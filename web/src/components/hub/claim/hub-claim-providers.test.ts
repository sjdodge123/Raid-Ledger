/**
 * ROK-2153 — the claim-provider registry and its gate (plugin active ∧ game ∧ kind).
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { GuildPage } from '@raid-ledger/contract';
import { clearRegistry, registerPlugin } from '../../../plugins/plugin-registry';
import { gatedHubClaimProvider, getHubClaimProviderRegistrations, type HubClaimProvider } from './hub-claim-providers';

const BADGE = { icon: 'V', color: '#000', label: 'Test' };

function page(gameSlug: string | undefined, kind: GuildPage['guild']['kind'] = 'game_server'): GuildPage {
    return {
        guild: { id: 7, gameId: 1, kind, name: 'Hub', region: 'us', realmSlug: null, realmName: null, faction: null, memberCount: 1, lastSnapshotAt: null, ...(gameSlug === undefined ? {} : { gameSlug }) },
        importedBy: null,
        viewer: { role: 'member', canEdit: false, canManageEditors: false },
        ranks: [],
        roleCounts: { tank: 0, healer: 0, dps: 0, unknown: 0 },
    };
}

const valheim: HubClaimProvider = { games: ['valheim'], kinds: ['game_server'] };

afterEach(() => clearRegistry());

describe('registerHubClaimProvider', () => {
    it('stores one provider per plugin; a re-register replaces it', () => {
        const handle = registerPlugin('valheim', BADGE);
        handle.registerHubClaimProvider(valheim);
        handle.registerHubClaimProvider({ ...valheim, copy: { heading: 'Claim' } });
        const regs = getHubClaimProviderRegistrations();
        expect(regs).toHaveLength(1);
        expect(regs[0]?.pluginSlug).toBe('valheim');
        expect(regs[0]?.provider.copy?.heading).toBe('Claim');
    });

    it('clearRegistry drops every provider', () => {
        registerPlugin('valheim', BADGE).registerHubClaimProvider(valheim);
        clearRegistry();
        expect(getHubClaimProviderRegistrations()).toEqual([]);
    });
});

describe('gatedHubClaimProvider', () => {
    it('returns the provider when its plugin is active and game + kind match', () => {
        registerPlugin('valheim', BADGE).registerHubClaimProvider(valheim);
        expect(gatedHubClaimProvider(page('valheim'), new Set(['valheim']))?.pluginSlug).toBe('valheim');
    });

    it('hides it while the plugin is inactive', () => {
        registerPlugin('valheim', BADGE).registerHubClaimProvider(valheim);
        expect(gatedHubClaimProvider(page('valheim'), new Set())).toBeUndefined();
    });

    it('hides it on another game, another hub kind, or a hub with no game', () => {
        registerPlugin('valheim', BADGE).registerHubClaimProvider(valheim);
        const active = new Set(['valheim']);
        expect(gatedHubClaimProvider(page('enshrouded'), active)).toBeUndefined();
        expect(gatedHubClaimProvider(page('valheim', 'game_community'), active)).toBeUndefined();
        expect(gatedHubClaimProvider(page(undefined), active)).toBeUndefined();
    });

    it('picks the provider that matches when two plugins register', () => {
        registerPlugin('valheim', BADGE).registerHubClaimProvider(valheim);
        registerPlugin('bg3', BADGE).registerHubClaimProvider({ games: ['baldurs-gate-3'], kinds: ['game_community'] });
        const active = new Set(['valheim', 'bg3']);
        expect(gatedHubClaimProvider(page('baldurs-gate-3', 'game_community'), active)?.pluginSlug).toBe('bg3');
    });
});
