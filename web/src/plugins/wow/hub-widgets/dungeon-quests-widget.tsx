/**
 * ROK-1924 (epic ROK-1905 W5) — the Forever "Dungeon quests" hub widget body:
 * the next 3 upcoming guild events with planned content, each with its quest
 * readiness. Lazy-loaded by `dungeon-quests.register.ts`.
 */
import type { JSX } from 'react';
import type { HubWidgetCtx } from '../../hub-game-widgets';
import { useMediaQuery } from '../../../hooks/use-media-query';
import { contentEvents, MATRIX_MQ } from './dungeon-quests.helpers';
import { EventQuestBlock } from './dungeon-quests-event';

/** Lists the next content events; renders nothing when there are none. */
export function DungeonQuestsWidget({ raids }: HubWidgetCtx): JSX.Element | null {
    const wide = useMediaQuery(MATRIX_MQ);
    const events = contentEvents(raids.data);
    if (events.length === 0) return null;
    return (
        <div className="flex flex-col gap-4">
            {events.map((e) => <EventQuestBlock key={e.id} event={e} wide={wide} />)}
        </div>
    );
}

export default DungeonQuestsWidget;
