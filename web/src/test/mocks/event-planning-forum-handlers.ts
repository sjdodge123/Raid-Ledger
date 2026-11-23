/**
 * ROK-2272 S5b — default admin "Event planning forum" handler: no bound
 * forums. Specs override with `server.use()`; the builders shape payloads.
 */
import { http, HttpResponse } from 'msw';
import type { EventPlanningForumCandidate, EventPlanningForumSettingsDto } from '@raid-ledger/contract';

export const EVENT_PLANNING_FORUM_URL = 'http://localhost:3000/admin/discord/event-planning-forum';

export function planningForumCandidate(overrides: Partial<EventPlanningForumCandidate> = {}): EventPlanningForumCandidate {
    return { channelId: '323456789012345678', name: 'event-planning', managed: true, ...overrides };
}

export function planningForumSettings(overrides: Partial<EventPlanningForumSettingsDto> = {}): EventPlanningForumSettingsDto {
    return { channelId: null, candidates: [], resolvedChannelId: null, ...overrides };
}

export const eventPlanningForumHandlers = [
    http.get(EVENT_PLANNING_FORUM_URL, () => HttpResponse.json(planningForumSettings())),
];
