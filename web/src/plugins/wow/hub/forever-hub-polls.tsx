/**
 * ROK-2212 (F1 ruling, 2026-11-17) — a scheduling poll may be tagged to a
 * WoW: Forever guild hub (the Suggested groups Poll button does it), so the
 * guild hub's Events tab lists them: the core `HubPollsSection`, mounted by
 * the Blizzard plugin's own `wowHubModule.eventsLead` slot (never by core).
 * Members and staff get "New poll"; the API re-checks the tag.
 */
import type { JSX } from 'react';
import { HubPollsSection } from '../../../components/hub/events/hub-polls-section';
import type { HubCtx } from '../../hub-module';
import { useForeverEventViewerAllowed } from '../hub-widgets/dungeon-quests.register';

/** The guild hub's open polls; mount only on a Forever guild page. */
export function ForeverHubPolls({ page }: Pick<HubCtx, 'page'>): JSX.Element {
    const canCreate = useForeverEventViewerAllowed(page);
    const { guild } = page;
    return <HubPollsSection hubId={guild.id} hubName={guild.name} gameId={guild.gameId} canCreate={canCreate} />;
}
