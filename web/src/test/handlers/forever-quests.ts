/**
 * ROK-1924 — MSW fixtures for the WoW: Forever Dungeon quests hub widget:
 * guild `/raids` cards carrying `contentInstances`, and the roster-wide
 * `quest-readiness` read (ROK-1906). Specs install them with `server.use()`.
 */
import { http, HttpResponse } from 'msw';
import type { EventQuestReadinessDto, GuildEventCardDto, GuildRaidsDto } from '@raid-ledger/contract';
import { emptyGuildRaids, GUILD_RAIDS_URL } from '../mocks/guild-raids-handlers';

export const QUEST_READINESS_URL = 'http://localhost:3000/plugins/wow-classic/events/:eventId/quest-readiness';

export const ALDRIC_CHARACTER_ID = '0b9a2f7e-1c3d-4e5f-8a9b-0c1d2e3f4a5b';

/** An upcoming guild event card; `instances` = its planned dungeons. */
export function contentEvent(id: number, startTime: string, instances: { id: number; name: string }[] = [{ id: 48, name: 'Blackfathom Deeps' }]): GuildEventCardDto {
    return {
        id, title: `Event ${id}`, startTime, endTime: startTime, signupCount: 2, needed: 5,
        viewerStatus: 'signed_up', contentInstances: instances,
    };
}

/** A `/raids` payload with these upcoming events. */
export function raidsWith(upcoming: GuildEventCardDto[]): GuildRaidsDto {
    return { ...emptyGuildRaids, upcoming };
}

/** Two quests × two signups covering every state and one unmet prereq. */
export const readinessFixture: EventQuestReadinessDto = {
    quests: [
        { questId: 909, title: 'Knowledge in the Deeps', instanceId: 48 },
        { questId: 1199, title: 'Twilight Falls', instanceId: 48 },
    ],
    signups: [
        { userId: 1, characterId: ALDRIC_CHARACTER_ID, name: 'Aldric', perQuest: [
            { questId: 909, state: 'done', prereqsMet: true, source: null },
            { questId: 1199, state: 'have', prereqsMet: true, source: null },
        ] },
        { userId: 2, characterId: null, name: 'Bryn', perQuest: [
            { questId: 909, state: 'missing', prereqsMet: false, source: null },
            { questId: 1199, state: 'unknown', prereqsMet: null, source: null },
        ] },
    ],
};

/** The pre-launch shape: the event has content, the dataset has no quests. */
export const emptyDatasetReadiness: EventQuestReadinessDto = { quests: [], signups: readinessFixture.signups.map((s) => ({ ...s, perQuest: [] })) };

export type ReadinessReply = EventQuestReadinessDto | 403 | 404;

/** Quest readiness per event id; an event not in the map gets a 404. */
export function questReadinessHandler(byEvent: Record<number, ReadinessReply>): ReturnType<typeof http.get> {
    return http.get(QUEST_READINESS_URL, ({ params }) => {
        const reply = byEvent[Number(params['eventId'])] ?? 404;
        if (typeof reply === 'number') return HttpResponse.json({ message: 'nope' }, { status: reply });
        return HttpResponse.json(reply);
    });
}

/** The guild `/raids` read answering with these upcoming events. */
export function guildRaidsHandler(upcoming: GuildEventCardDto[]): ReturnType<typeof http.get> {
    return http.get(GUILD_RAIDS_URL, () => HttpResponse.json(raidsWith(upcoming)));
}
