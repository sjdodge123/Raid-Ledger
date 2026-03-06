import { API_BASE_URL } from '../config';
import { getAuthToken } from '../../hooks/use-auth';

/**
 * Generic fetch wrapper with Zod validation.
 * Central HTTP layer for all API calls.
 */
export async function fetchApi<T>(
    endpoint: string,
    options: RequestInit = {},
    schema?: { parse: (data: unknown) => T }
): Promise<T> {
    const url = `${API_BASE_URL}${endpoint}`;

    const token = getAuthToken();
    const authHeaders: Record<string, string> = {};
    if (token) {
        authHeaders['Authorization'] = `Bearer ${token}`;
    }

    // Don't set Content-Type for FormData -- browser sets it with boundary
    const isFormData = options.body instanceof FormData;
    const contentHeaders: Record<string, string> = isFormData
        ? {}
        : { 'Content-Type': 'application/json' };

    const response = await fetch(url, {
        ...options,
        headers: {
            ...contentHeaders,
            ...authHeaders,
            ...options.headers,
        },
        credentials: 'include',
    });

    if (!response.ok) {
        const error = await response.json().catch(
            () => ({ message: 'Request failed' }),
        );
        const details = Array.isArray(error.errors)
            ? error.errors.join(', ')
            : '';
        const message = details
            ? `${error.message || 'Request failed'}: ${details}`
            : error.message || `HTTP ${response.status}`;
        throw new Error(message);
    }

    // Handle 204 No Content
    if (response.status === 204) {
        return undefined as T;
    }

    const data = await response.json();

    if (schema) {
        return schema.parse(data);
    }

    return data as T;
}
