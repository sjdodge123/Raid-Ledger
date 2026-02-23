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
 * Merges results from multiple instances into a single list.
 *
 * ROK-246: Dungeon Companion — Quest Suggestions UI
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
            // Flatten and deduplicate by questId
            const seen = new Set<number>();
            const quests: EnrichedDungeonQuestDto[] = [];
            for (const batch of results) {
                for (const quest of batch) {
                    if (!seen.has(quest.questId)) {
                        seen.add(quest.questId);
                        quests.push(quest);
                    }
                }
            }
            return quests;
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
