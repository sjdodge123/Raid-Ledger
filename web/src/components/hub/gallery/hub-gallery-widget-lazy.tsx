/** ROK-1942 — lazy chunk for the hub Overview Gallery card. */
import { lazy } from 'react';

export const LazyHubGalleryWidget = lazy(() => import('./hub-gallery-widget'));
