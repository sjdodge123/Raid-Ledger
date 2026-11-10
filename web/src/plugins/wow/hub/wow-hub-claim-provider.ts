/**
 * ROK-2153 S5 — the web half of the api `blizzard` hub claim provider
 * (`wow-hub-claim.provider.ts`): WoW: Forever guild hubs, the games the api
 * provider serves (its claimable-guild rule is the join gate's).
 *
 * Deliberately no `OptionsStep` and no copy: on a WoW hub membership IS a
 * claimed roster row (`viewerHasClaim` = membership), so the core Overview
 * prompt never shows for a member, and a non-member is not a member. A status
 * that needs a ruleset (`claimOptions: 'wow_ruleset'`) and has no options step
 * fails closed in the core cell. The claim action stays where it was: the join
 * gate and the staff `forever-claim-banner` open Add character → Guild roster.
 */
import type { HubClaimProvider } from '../../../components/hub/claim/hub-claim-providers';
import { WOW_FOREVER_GAME_SLUG } from '../lib/forever-identity';

export const wowHubClaimProvider: HubClaimProvider = {
    games: [WOW_FOREVER_GAME_SLUG],
    kinds: ['wow_guild'],
};
