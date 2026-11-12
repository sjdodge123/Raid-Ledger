/**
 * Core's "GG <year>" card renderers (ROK-2187), one per `GG_CORE_CARD_IDS`
 * entry — each declared as a `gg-card` behaviour of `core` (W9 guard). Bodies
 * are lazy so the app entry chunk stays light.
 */
import { lazy } from 'react';
import {
    GgEventsCardSchema, GgHoursCardSchema, GgHubsCardSchema, GgIntroCardSchema, GgNewGamesCardSchema,
    GgOnTimeCardSchema, GgPeopleCardSchema, GgRhythmCardSchema, GgSummaryCardSchema, GgSuperlativeCardSchema,
    GgTopGamesCardSchema, GgVoiceCardSchema,
} from '@raid-ledger/contract';
import type { PluginHandle } from '../../plugin-registry';

const stat = () => import('./core-stat-cards');
const games = () => import('./core-games-cards');
const people = () => import('./core-people-cards');

const coverOf = (p: { games: { coverUrl?: string | null | undefined }[] }): string | undefined =>
    p.games.find((g) => g.coverUrl)?.coverUrl ?? undefined;

/** Register every core GG card on the core plugin handle. */
export function registerCoreGgCards(core: PluginHandle): void {
    core.registerGgCard({ id: 'intro', label: 'GG intro', order: 0, schema: GgIntroCardSchema, Component: lazy(() => import('./core-intro-card').then((m) => ({ default: m.GgIntroCardView }))) });
    core.registerGgCard({ id: 'events', label: 'Events', order: 10, schema: GgEventsCardSchema, Component: lazy(() => stat().then((m) => ({ default: m.GgEventsCardView }))) });
    core.registerGgCard({ id: 'on-time', label: 'On time', order: 20, schema: GgOnTimeCardSchema, Component: lazy(() => stat().then((m) => ({ default: m.GgOnTimeCardView }))) });
    core.registerGgCard({ id: 'rhythm', label: 'Your rhythm', order: 30, schema: GgRhythmCardSchema, Component: lazy(() => stat().then((m) => ({ default: m.GgRhythmCardView }))) });
    core.registerGgCard({ id: 'hours', label: 'Hours played', order: 40, schema: GgHoursCardSchema, Component: lazy(() => stat().then((m) => ({ default: m.GgHoursCardView }))) });
    core.registerGgCard({ id: 'top-games', label: 'Top games', order: 50, schema: GgTopGamesCardSchema, backgroundSrc: coverOf, durationMs: 12_000, Component: lazy(() => games().then((m) => ({ default: m.GgTopGamesCardView }))) });
    core.registerGgCard({ id: 'new-games', label: 'New games', order: 60, schema: GgNewGamesCardSchema, backgroundSrc: coverOf, Component: lazy(() => games().then((m) => ({ default: m.GgNewGamesCardView }))) });
    core.registerGgCard({ id: 'voice', label: 'Voice', order: 70, schema: GgVoiceCardSchema, Component: lazy(() => stat().then((m) => ({ default: m.GgVoiceCardView }))) });
    core.registerGgCard({ id: 'people', label: 'Your people', order: 80, schema: GgPeopleCardSchema, Component: lazy(() => people().then((m) => ({ default: m.GgPeopleCardView }))) });
    core.registerGgCard({ id: 'hubs', label: 'Hubs', order: 90, schema: GgHubsCardSchema, Component: lazy(() => stat().then((m) => ({ default: m.GgHubsCardView }))) });
    core.registerGgCard({ id: 'superlative', label: 'Your GG persona', order: 200, schema: GgSuperlativeCardSchema, Component: lazy(() => people().then((m) => ({ default: m.GgSuperlativeCardView }))) });
    core.registerGgCard({ id: 'summary', label: 'Summary', order: 210, schema: GgSummaryCardSchema, backgroundSrc: (p) => coverOf({ games: p.topGames }), Component: lazy(() => people().then((m) => ({ default: m.GgSummaryCardView }))) });
}
