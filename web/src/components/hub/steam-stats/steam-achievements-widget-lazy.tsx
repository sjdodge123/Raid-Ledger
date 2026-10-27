/** ROK-1953 — lazy chunk for the hub Overview Achievement race card. */
import { lazy } from 'react';

export const LazySteamAchievementsWidget = lazy(() => import('./steam-achievements-widget'));
