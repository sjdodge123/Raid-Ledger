/**
 * ROK-2272 S5b — the admin "Event planning forum" pick
 * (`GET/PUT /admin/discord/event-planning-forum`, admin guard). Responses
 * parse against the strict contract schema; a save replaces the cached read
 * with the server's answer, so the card shows what was stored.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
    EventPlanningForumSettingsSchema,
    type EventPlanningForumSettingsDto,
    type UpdateEventPlanningForumDto,
} from '@raid-ledger/contract';
import { fetchApi } from '../../lib/api-client';
import { toast } from '../../lib/toast';

const PATH = '/admin/discord/event-planning-forum';
export const EVENT_PLANNING_FORUM_KEY = ['admin', 'discord', 'event-planning-forum'] as const;

/** The stored pick, the bound forums (candidates) and the forum in use. */
export function useEventPlanningForum() {
    return useQuery<EventPlanningForumSettingsDto>({
        queryKey: [...EVENT_PLANNING_FORUM_KEY],
        queryFn: () => fetchApi(PATH, {}, EventPlanningForumSettingsSchema),
    });
}

/** Store a candidate's channel id, or null to clear the pick. */
export function useSaveEventPlanningForum() {
    const queryClient = useQueryClient();
    return useMutation<EventPlanningForumSettingsDto, Error, string | null>({
        mutationFn: (channelId) => {
            const body: UpdateEventPlanningForumDto = { channelId };
            return fetchApi(PATH, { method: 'PUT', body: JSON.stringify(body) }, EventPlanningForumSettingsSchema);
        },
        onSuccess: (data) => {
            queryClient.setQueryData([...EVENT_PLANNING_FORUM_KEY], data);
            toast.success('Event planning forum saved');
        },
    });
}
