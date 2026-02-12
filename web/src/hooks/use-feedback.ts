import { useMutation } from '@tanstack/react-query';
import type { CreateFeedbackDto, FeedbackResponseDto } from '@raid-ledger/contract';
import { fetchApi } from '../lib/api-client';

/**
 * Hook for submitting user feedback.
 * ROK-186: User Feedback Widget.
 */
export function useSubmitFeedback() {
    return useMutation<FeedbackResponseDto, Error, CreateFeedbackDto>({
        mutationFn: async (data) => {
            return fetchApi<FeedbackResponseDto>('/feedback', {
                method: 'POST',
                body: JSON.stringify(data),
            });
        },
    });
}
