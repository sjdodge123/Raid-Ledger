/** ROK-1933 — lazy chunk for the Overview claim banner card. */
import { lazy } from 'react';

export const LazyValheimClaimBannerWidget = lazy(
    () => import('./valheim-claim-banner-widget'),
);
