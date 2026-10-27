/** ROK-1968 — lazy chunk for the hub Overview "Before next session" card. */
import { lazy } from 'react';

export const LazyHubSessionNoteWidget = lazy(() => import('./hub-session-note-widget'));
