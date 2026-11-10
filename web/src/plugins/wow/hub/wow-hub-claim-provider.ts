/**
 * ROK-2153 S5 — the web half of the api `blizzard` hub claim provider
 * (`wow-hub-claim.provider.ts`): WoW: Forever guild hubs, the games the api
 * provider serves (its claimable-guild rule is the join gate's).
 *
 * `overviewPrompt: false`: on a WoW hub membership IS a claimed roster row
 * (`viewerHasClaim` = membership), so the core Overview prompt could never
 * show. The Overview therefore treats WoW as "no claim provider": it sends no
 * `GET guilds/:id/claim`, renders no claim cell and never holds the Companion
 * prompt back. The claim action stays where it was: the join gate and the
 * staff `forever-claim-banner` open Add character → Guild roster. The
 * registration still exists so the ownership guard pairs it with the manifest.
 */
import type { HubClaimProvider } from '../../../components/hub/claim/hub-claim-providers';
import { WOW_FOREVER_GAME_SLUG } from '../lib/forever-identity';

export const wowHubClaimProvider: HubClaimProvider = {
    games: [WOW_FOREVER_GAME_SLUG],
    kinds: ['wow_guild'],
    overviewPrompt: false,
};
