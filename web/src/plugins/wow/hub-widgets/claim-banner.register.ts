/**
 * ROK-2151 — registers the staff "Claim your character" banner on WoW: Forever
 * guild hubs (D2). Order 5 puts it above every Overview card; span 3 is the
 * full row. `chrome: 'none'`: the banner is its own §4.7 callout + landmark, so
 * no WidgetCard heading goes over it. `audience: 'everyone'` because the probe
 * itself (staff, claimable, not a member, not dismissed) decides who sees it.
 */
import { lazy } from 'react';
import type { PluginHandle } from '../../plugin-registry';
import { WOW_FOREVER_GAME_SLUG } from '../lib/forever-identity';
import { useForeverClaimBannerVisible } from '../hub/use-wow-claim-banner';

/** Adds the claim banner widget to the given (WoW) plugin. */
export function registerClaimBannerWidget(plugin: PluginHandle): void {
    plugin.registerHubWidget({
        id: 'forever-claim-banner',
        title: 'Claim your character',
        description: 'Asks staff who are not guild members to claim their character.',
        games: [WOW_FOREVER_GAME_SLUG],
        kinds: ['wow_guild'],
        order: 5,
        span: 3,
        audience: 'everyone',
        chrome: 'none',
        component: lazy(() => import('../hub/wow-claim-banner')),
        useVisible: useForeverClaimBannerVisible,
    });
}
