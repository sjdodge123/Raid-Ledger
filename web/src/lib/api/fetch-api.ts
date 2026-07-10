import { API_BASE_URL } from '../config';
import { getAuthToken } from '../../hooks/use-auth';
import { ensureFreshToken } from './refresh-client';
import { getAuthMethod } from './silent-reauth';
import { Sentry } from '../../sentry';
import type { ZodType } from 'zod';

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
 * Thrown when an API response fails Zod schema validation.
 * ROK-1237: the raw issue array MUST NEVER reach `.message` — it's only
 * carried in Sentry's `extra` payload. UI consumers display a stable
 * user-facing string and branch on `instanceof SchemaValidationError`
 * to render a soft error state instead of a 404.
 */
export class SchemaValidationError extends Error {
    readonly endpoint: string;
    constructor(endpoint: string) {
        super('We received an unexpected response from the server.');
        Object.setPrototypeOf(this, SchemaValidationError.prototype);
        this.name = 'SchemaValidationError';
        this.endpoint = endpoint;
    }
}

/**
 * Generic fetch wrapper with Zod validation.
 * Central HTTP layer for all API calls.
 */
/** Issue the actual HTTP request with the current auth headers. */
function sendRequest(endpoint: string, options: RequestInit): Promise<Response> {
    return fetch(`${API_BASE_URL}${endpoint}`, {
        ...options,
        headers: buildHeaders(options),
        credentials: 'include',
    });
}

/**
 * ROK-1353 / ROK-1367: the single authenticated-fetch primitive. Sends the
 * request with the current Bearer token and, on a 401, performs ONE
 * transparent refresh from the httpOnly `rl_rt` cookie (single-flight) and
 * retries exactly once — the user never sees a login screen for a merely
 * expired access token. Gated on the prior-session marker so anonymous
 * visitors' 401s don't emit pointless refresh probes.
 *
 * Returns the raw Response so callers that need to branch on a status code
 * fetchApi would otherwise turn into a thrown Error (e.g. 503 → "unavailable"
 * or "no snapshot yet") can inspect it while still sharing the 401 path.
 */
export async function fetchWithAuth(
    endpoint: string,
    options: RequestInit = {},
): Promise<Response> {
    const response = await sendRequest(endpoint, options);
    if (response.status === 401 && getAuthMethod()) {
        const refreshed = await ensureFreshToken();
        if (refreshed) return sendRequest(endpoint, options);
    }
    return response;
}

export async function fetchApi<T>(
    endpoint: string,
    options: RequestInit = {},
    schema?: ZodType<T>
): Promise<T> {
    const response = await fetchWithAuth(endpoint, options);

    if (!response.ok) return handleErrorResponse(response);
    if (response.status === 204) return undefined as T;

    const data = await response.json();
    if (!schema) return data as T;

    const result = schema.safeParse(data);
    if (result.success) return result.data;

    // Capture the raw issue array in Sentry only — never on the thrown
    // message, to keep the issue payload out of the rendered DOM.
    Sentry.captureException(new Error('Response schema validation failed'), {
        extra: { endpoint, issues: result.error.issues },
    });
    throw new SchemaValidationError(endpoint);
}
