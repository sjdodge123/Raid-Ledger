/**
 * ROK-1958 D-10 — visibility probes for the BG3 widgets (`useVisible`).
 * Members AND staff (the api lets non-member staff read, ROK-1957 D-15), and
 * the campaigns query did not 403/404. Party stays visible with no campaign
 * (it carries the binding entry point); Where we are + Session history need a
 * non-empty snapshot. Probes share the widgets' queries (one fetch each).
 */
import type { HubWidgetCtx } from '../../hub-game-widgets';
import { isOperatorOrAdmin, useAuth } from '../../../hooks/use-auth';
import { isBg3AccessDenied } from '../api/bg3-api';
import { useBg3Campaigns, useBg3Snapshot } from './use-bg3-hub';

/** Member or staff — the only viewers the bg3 read routes let in. */
export function useBg3ViewerAllowed({ page }: HubWidgetCtx): boolean {
    const { user } = useAuth();
    return page.viewer.role !== 'visitor' || isOperatorOrAdmin(user);
}

/** Party: allowed and the campaigns query is not an access denial. */
export function useBg3PartyVisible(ctx: HubWidgetCtx): boolean {
    const allowed = useBg3ViewerAllowed(ctx);
    const campaigns = useBg3Campaigns(ctx.page.guild.id, allowed);
    return allowed && !(campaigns.isError && isBg3AccessDenied(campaigns.error));
}

/** Where we are / Session history: Party's rule AND a non-empty active snapshot. */
export function useBg3SnapshotVisible(ctx: HubWidgetCtx): boolean {
    const partyVisible = useBg3PartyVisible(ctx);
    const snapshot = useBg3Snapshot(ctx.page.guild.id, partyVisible);
    return partyVisible && snapshot.data != null && !snapshot.data.empty;
}
