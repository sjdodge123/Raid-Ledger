/** ROK-1175 — lazy chunk for the hub Overview "Latest threads" card. */
import { lazy } from 'react';

export const LazyForumLatestWidget = lazy(() => import('./forum-latest-widget'));
