/**
 * React Query hook for standalone scheduling polls (ROK-977).
 * Provides a mutation for creating standalone scheduling polls.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { CreateSchedulingPollDto } from '@raid-ledger/contract';
import { toast } from '../lib/toast';
import { createSchedulingPoll } from '../lib/api-client';

/**
 * Mutation hook for creating a standalone scheduling poll.
 * On success, invalidates scheduling-related queries and returns
 * the poll response (matchId + lineupId for navigation).
 */
export function useCreateSchedulingPoll() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreateSchedulingPollDto) => createSchedulingPoll(dto),
    onSuccess: () => {
      toast.success('Scheduling poll created!');
      void queryClient.invalidateQueries({
        queryKey: ['scheduling-banner'],
      });
      void queryClient.invalidateQueries({ queryKey: ['lineups'] });
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to create scheduling poll');
    },
  });
}
