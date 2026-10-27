/** ROK-1953 — lazy chunk for the hub Overview Playtime card. */
import { lazy } from 'react';

export const LazySteamPlaytimeWidget = lazy(() => import('./steam-playtime-widget'));
