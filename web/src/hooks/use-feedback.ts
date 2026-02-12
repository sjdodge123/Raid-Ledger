import { useMutation } from '@tanstack/react-query';
import type { CreateFeedbackDto, FeedbackResponseDto } from '@raid-ledger/contract';
import { API_BASE_URL } from '../lib/config';
import { getAuthToken } from './use-auth';

/**
 * Hook for submitting user feedback.
 * ROK-186: User Feedback Widget.
 */
export function useSubmitFeedback() {
    return useMutation<FeedbackResponseDto, Error, CreateFeedbackDto>({
        mutationFn: async (data) => {
            const response = await fetch(`${API_BASE_URL}/feedback`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${getAuthToken() || ''}`,
                },
                body: JSON.stringify(data),
            });

            if (!response.ok) {
                const err = await response.json().catch(() => ({}));
                throw new Error(
                    err.message || 'Failed to submit feedback',
                );
            }

            return response.json();
        },
    });
}
