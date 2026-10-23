/** ROK-1930 — lazy chunk for the Overview Deaths card. */
import { lazy } from 'react';

export const LazyValheimDeathsWidget = lazy(() => import('./valheim-deaths-widget'));
