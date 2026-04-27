/**
 * Shared API helpers for Playwright smoke tests.
 *
 * Centralises getAdminToken (with retry + module-level caching),
 * apiGet, apiPost, apiPatch, apiPut, and apiDelete so that individual
 * smoke spec files don't duplicate this boilerplate.
 */

import { readFile } from 'node:fs/promises';
import { resolve as resolvePath } from 'node:path';

export const API_BASE = process.env.API_URL || 'http://localhost:3000';

// ---------------------------------------------------------------------------
// Admin token — cached at module level, with 429 back-off retry
// ---------------------------------------------------------------------------

// ROK-1085: globalSetup writes the JWT to scripts/.auth/admin-token.json so
// each Playwright worker can read the cached token instead of hammering
// /auth/local in parallel (the rate limiter rejected the fan-out and caused
// flaky smoke runs). Falls back to the live login if the file is absent.
const TOKEN_FILE_PATH = resolvePath(__dirname, '..', '.auth', 'admin-token.json');

let _cachedToken: string | null = null;
let _tokenPromise: Promise<string> | null = null;

async function readTokenFromDisk(): Promise<string | null> {
    try {
        const raw = await readFile(TOKEN_FILE_PATH, 'utf8');
        const parsed = JSON.parse(raw) as { access_token?: unknown };
        if (typeof parsed.access_token === 'string' && parsed.access_token) {
            return parsed.access_token;
        }
        return null;
    } catch {
        return null;
    }
}

async function loginViaApi(): Promise<string> {
    for (let attempt = 0; attempt < 3; attempt++) {
        const res = await fetch(`${API_BASE}/auth/local`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                username: 'admin@local',
                password: process.env.ADMIN_PASSWORD || 'password',
            }),
        });
        if (res.ok) {
            const { access_token } = (await res.json()) as {
                access_token: string;
            };
            return access_token;
        }
        if (res.status === 429) {
            const wait = attempt === 0 ? 5_000 : 15_000;
            await new Promise((r) => setTimeout(r, wait));
            continue;
        }
        throw new Error(`Auth failed: ${res.status}`);
    }
    throw new Error('Auth failed after 3 attempts (rate limited)');
}

export async function getAdminToken(): Promise<string> {
    if (_cachedToken) return _cachedToken;
    if (_tokenPromise) return _tokenPromise;
    _tokenPromise = (async () => {
        const fromDisk = await readTokenFromDisk();
        if (fromDisk) return fromDisk;
        return loginViaApi();
    })();
    _cachedToken = await _tokenPromise;
    _tokenPromise = null;
    return _cachedToken;
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

/** GET — returns parsed JSON or null on non-OK responses. */
export async function apiGet(token: string, path: string) {
    const res = await fetch(`${API_BASE}${path}`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const text = await res.text();
    return text ? JSON.parse(text) : null;
}

/** POST — body is optional, returns parsed JSON. */
export async function apiPost(
    token: string,
    path: string,
    body?: Record<string, unknown>,
) {
    const res = await fetch(`${API_BASE}${path}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        },
        body: body ? JSON.stringify(body) : undefined,
    });
    return res.json();
}

/** PATCH — returns parsed JSON. */
export async function apiPatch(
    token: string,
    path: string,
    body: Record<string, unknown>,
) {
    const res = await fetch(`${API_BASE}${path}`, {
        method: 'PATCH',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
    });
    return res.json();
}

/** PUT — returns parsed JSON. */
export async function apiPut(
    token: string,
    path: string,
    body: Record<string, unknown>,
) {
    const res = await fetch(`${API_BASE}${path}`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
    });
    return res.json();
}

/** DELETE — fire-and-forget (no return value). */
export async function apiDelete(token: string, path: string) {
    await fetch(`${API_BASE}${path}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
    });
}
