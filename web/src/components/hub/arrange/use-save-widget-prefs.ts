/**
 * ROK-1918 L5 — `PATCH /guilds/:id/widget-prefs`: save a layout, or Reset
 * (`{ reset: true }` stores `null`). Lives in the lazy arrange chunk, not in
 * `hub/api`, so members never download it (the `hub-page` gzip budget).
 * Success invalidates the guild page query — `HubOverview` reads
 * `page.widgetPrefs`, so the grid re-renders with the stored layout.
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { HubWidgetPrefsResponseSchema, type HubWidgetPrefsResponse, type UpdateHubWidgetPrefsBody } from '@raid-ledger/contract';
import { fetchApi } from '../../../lib/api-client';
import { guildPageKey } from '../api/use-guild';

export function patchWidgetPrefs(guildId: number, body: UpdateHubWidgetPrefsBody): Promise<HubWidgetPrefsResponse> {
    return fetchApi(`/guilds/${guildId}/widget-prefs`, { method: 'PATCH', body: JSON.stringify(body) }, HubWidgetPrefsResponseSchema);
}

export function useSaveWidgetPrefs(guildId: number): UseMutationResult<HubWidgetPrefsResponse, Error, UpdateHubWidgetPrefsBody> {
    const queryClient = useQueryClient();
    return useMutation<HubWidgetPrefsResponse, Error, UpdateHubWidgetPrefsBody>({
        mutationFn: (body) => patchWidgetPrefs(guildId, body),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: guildPageKey(guildId) }),
    });
}
