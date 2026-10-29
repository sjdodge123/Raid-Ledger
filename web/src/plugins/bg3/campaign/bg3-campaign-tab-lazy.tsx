/** ROK-1958 — lazy chunk for the BG3 Campaign game tab (D-3). */
import { lazy } from 'react';

export const LazyBg3CampaignTab = lazy(() => import('./bg3-campaign-tab'));
