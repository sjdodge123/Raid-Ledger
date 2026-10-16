/**
 * Shared fetch helper for admin settings hooks.
 * Provides a consistent pattern for authenticated admin API calls.
 */
import { API_BASE_URL } from '../../lib/config';
import { ensureFreshToken } from '../../lib/api/refresh-client';
import { getAuthMethod } from '../../lib/api/silent-reauth';
import { isTokenStale } from '../../lib/api/token-expiry';
import { getAuthToken } from '../use-auth';
import { nativeFetch } from '../../lib/api/native-fetch';

/** Build auth headers with current token */
export function getHeaders(): Record<string, string> {
    return {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${getAuthToken() || ''}`,
    };
}

/**
 * A failed non-GET admin call. `message` is the server's message (or the
 * caller's fallback); `status` and the parsed `body` let a caller read
 * structured error fields, e.g. the join post's 422 `missing` list (ROK-1740).
 */
export class AdminFetchError extends Error {
    readonly status: number;
    readonly body: unknown;

    constructor(message: string, status: number, body: unknown) {
        super(message);
        this.name = 'AdminFetchError';
        this.status = status;
        this.body = body;
    }
}

/** Builds the error for a failed non-GET call from its (optional) JSON body. */
async function toAdminFetchError(response: Response, fallback: string): Promise<AdminFetchError> {
    const body: unknown = await response.json().catch(() => null);
    const message = (body as { message?: unknown } | null)?.message;
    return new AdminFetchError(message ? String(message) : fallback, response.status, body);
}

/** Standard admin fetch with error handling */
export async function adminFetch<T>(
    path: string,
    options?: RequestInit,
    errorMessage = 'Request failed',
): Promise<T> {
    let response: Response;
    try {
        // ROK-1409: pre-flight staleness gate — refresh once up front when the
        // stored access token is already expired (boot/resume), so parallel
        // admin queries don't each 401 + retry. Single-flight + impersonation
        // self-guard in ensureFreshToken; the reactive path below still covers
        // server-side revocation / clock skew.
        if (getAuthMethod() && isTokenStale(getAuthToken())) {
            await ensureFreshToken();
        }
        response = await nativeFetch(`${API_BASE_URL}${path}`, {
            ...options,
            headers: getHeaders(),
        });
        // ROK-1353: expired 1h access token — transparent single-flight
        // refresh + one retry (no-op while impersonating).
        if (response.status === 401 && (await ensureFreshToken())) {
            response = await nativeFetch(`${API_BASE_URL}${path}`, {
                ...options,
                headers: getHeaders(),
            });
        }
    } catch {
        throw new Error(errorMessage);
    }

    if (!response.ok) {
        if (options?.method && options.method !== 'GET') {
            throw await toAdminFetchError(response, errorMessage);
        }
        throw new Error(errorMessage);
    }

    return response.json();
}
