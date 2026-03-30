import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
    fetchEnrichedQuests,
    fetchQuestProgress,
    fetchQuestCoverage,
    updateQuestProgress,
} from '../api-client';
import type {
    EnrichedDungeonQuestDto,
    QuestProgressDto,
    QuestCoverageEntry,
} from '@raid-ledger/contract';

/**
 * Fetch enriched quests for all content instances of an event.
 * Returns a Map keyed by instance ID with per-instance quest arrays.
 * Each instance's quests are deduplicated by questId independently.
 *
 * ROK-246: Dungeon Companion — Quest Suggestions UI
 * ROK-995: Group quests by dungeon for multi-dungeon events
 */
export function useEnrichedQuests(
    instanceIds: number[],
    variant: string | undefined,
) {
    return useQuery({
        queryKey: ['enriched-quests', instanceIds, variant],
        queryFn: async () => {
            const results = await Promise.all(
                instanceIds.map((id) =>
                    fetchEnrichedQuests(id, variant ?? 'classic_era'),
                ),
            );
            const questsByInstance = new Map<number, EnrichedDungeonQuestDto[]>();
            for (let i = 0; i < instanceIds.length; i++) {
                const seen = new Set<number>();
                const deduped: EnrichedDungeonQuestDto[] = [];
                for (const quest of results[i]) {
                    if (!seen.has(quest.questId)) {
                        seen.add(quest.questId);
                        deduped.push(quest);
                    }
                }
                questsByInstance.set(instanceIds[i], deduped);
            }
            return questsByInstance;
        },
        enabled: instanceIds.length > 0 && !!variant,
        staleTime: 1000 * 60 * 5, // 5 min cache
    });
}

/**
 * Fetch quest progress for all players on an event.
 */
export function useQuestProgress(eventId: number | undefined) {
    return useQuery<QuestProgressDto[]>({
        queryKey: ['quest-progress', eventId],
        queryFn: () => fetchQuestProgress(eventId!),
        enabled: !!eventId,
        staleTime: 1000 * 30, // 30s — progress changes frequently
    });
}

/**
 * Fetch sharable quest coverage for an event.
 */
export function useQuestCoverage(eventId: number | undefined) {
    return useQuery<QuestCoverageEntry[]>({
        queryKey: ['quest-coverage', eventId],
        queryFn: () => fetchQuestCoverage(eventId!),
        enabled: !!eventId,
        staleTime: 1000 * 30,
    });
}

/**
 * Mutation to update quest progress for the current user.
 * Invalidates both progress and coverage queries on success.
 */
export function useUpdateQuestProgress(eventId: number | undefined) {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (body: { questId: number; pickedUp?: boolean; completed?: boolean }) =>
            updateQuestProgress(eventId!, body),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['quest-progress', eventId] });
            queryClient.invalidateQueries({ queryKey: ['quest-coverage', eventId] });
        },
        onError: (error: Error) => {
            console.error('[QuestProgress] Update failed:', error.message);
        },
    });
}
