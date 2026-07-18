/**
 * Shared fetch helper for admin settings hooks.
 * Provides a consistent pattern for authenticated admin API calls.
 */
import { API_BASE_URL } from '../../lib/config';
import { ensureFreshToken } from '../../lib/api/refresh-client';
import { getAuthMethod } from '../../lib/api/silent-reauth';
import { isTokenStale } from '../../lib/api/token-expiry';
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
        response = await fetch(`${API_BASE_URL}${path}`, {
            ...options,
            headers: getHeaders(),
        });
        // ROK-1353: expired 1h access token — transparent single-flight
        // refresh + one retry (no-op while impersonating).
        if (response.status === 401 && (await ensureFreshToken())) {
            response = await fetch(`${API_BASE_URL}${path}`, {
                ...options,
                headers: getHeaders(),
            });
        }
    } catch {
        throw new Error(errorMessage);
    }

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
