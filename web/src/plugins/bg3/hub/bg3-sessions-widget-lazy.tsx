/** ROK-1958 — lazy chunk for the BG3 "Session history" card. */
import { lazy } from 'react';

export const LazyBg3SessionsWidget = lazy(() => import('./bg3-sessions-widget'));
