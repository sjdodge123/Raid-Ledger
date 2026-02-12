import { useMutation, useQueryClient } from '@tanstack/react-query';
import { updateEvent } from '../lib/api-client';
import { toast } from '../lib/toast';

/**
 * Mutation hook to toggle the autoUnbench setting on an event (ROK-229).
 * Calls PATCH /events/:id with { autoUnbench } and invalidates the event cache.
 */
export function useUpdateAutoUnbench(eventId: number) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (autoUnbench: boolean) =>
      updateEvent(eventId, { autoUnbench }),
    onSuccess: (_, autoUnbench) => {
      queryClient.invalidateQueries({ queryKey: ['events', eventId] });
      toast.success(autoUnbench ? 'Auto-sub enabled' : 'Auto-sub disabled');
    },
    onError: (error: Error) => {
      toast.error('Failed to update auto-sub setting', {
        description: error.message,
      });
    },
  });
}
