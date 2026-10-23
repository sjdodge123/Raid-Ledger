/**
 * ROK-1933 Part 1 — the claim banner as a Valheim server hub Overview card
 * (dismissible, Q3). Default export so `register.ts` can `React.lazy` it; the
 * card is gated by `useClaimBannerWidgetVisible`.
 */
import type { JSX } from 'react';
import type { HubWidgetCtx } from '../../hub-game-widgets';
import { ValheimClaimBanner } from './valheim-claim-banner';

export default function ValheimClaimBannerWidget({ page }: HubWidgetCtx): JSX.Element | null {
    const serverId = page.server?.pelicanServerId ?? 0;
    if (serverId <= 0) return null;
    return <ValheimClaimBanner serverId={serverId} dismissible />;
}
