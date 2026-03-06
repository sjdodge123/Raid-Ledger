/**
 * Shared fetch helper for admin settings hooks.
 * Provides a consistent pattern for authenticated admin API calls.
 */
import { API_BASE_URL } from '../../lib/config';
import { getAuthToken } from '../use-auth';

/** Build auth headers with current token */
export function getHeaders(): Record<string, string> {
    return {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${getAuthToken() || ''}`,
    };
}

/** Standard admin fetch with error handling */
export async function adminFetch<T>(
    path: string,
    options?: RequestInit,
    errorMessage = 'Request failed',
): Promise<T> {
    const response = await fetch(`${API_BASE_URL}${path}`, {
        ...options,
        headers: getHeaders(),
    });

    if (!response.ok) {
        if (options?.method && options.method !== 'GET') {
            const error = await response.json().catch(
                () => ({ message: errorMessage }),
            );
            throw new Error(error.message || errorMessage);
        }
        throw new Error(errorMessage);
    }

    return response.json();
}
