import { API_BASE_URL } from '../config';
import { getAuthToken } from '../../hooks/use-auth';

function buildHeaders(options: RequestInit): Record<string, string> {
    const token = getAuthToken();
    const authHeaders: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};

    // Don't set Content-Type for FormData -- browser sets it with boundary
    const isFormData = options.body instanceof FormData;
    const contentHeaders: Record<string, string> = isFormData
        ? {}
        : { 'Content-Type': 'application/json' };

    return { ...contentHeaders, ...authHeaders, ...(options.headers as Record<string, string>) };
}

async function handleErrorResponse(response: Response): Promise<never> {
    const error = await response.json().catch(() => ({ message: 'Request failed' }));
    const details = Array.isArray(error.errors) ? error.errors.join(', ') : '';
    const message = details
        ? `${error.message || 'Request failed'}: ${details}`
        : error.message || `HTTP ${response.status}`;
    throw new Error(message);
}

/**
 * Generic fetch wrapper with Zod validation.
 * Central HTTP layer for all API calls.
 */
export async function fetchApi<T>(
    endpoint: string,
    options: RequestInit = {},
    schema?: { parse: (data: unknown) => T }
): Promise<T> {
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
        ...options,
        headers: buildHeaders(options),
        credentials: 'include',
    });

    if (!response.ok) return handleErrorResponse(response);
    if (response.status === 204) return undefined as T;

    const data = await response.json();
    return schema ? schema.parse(data) : (data as T);
}
