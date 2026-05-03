/**
 * Shared API helpers for Playwright smoke tests.
 *
 * Centralises getAdminToken (with retry + module-level caching),
 * apiGet, apiPost, apiPatch, apiPut, and apiDelete so that individual
 * smoke spec files don't duplicate this boilerplate.
 */

import { readFile } from 'node:fs/promises';
import { TOKEN_FILE_PATH } from '../auth-paths';

export const API_BASE = process.env.API_URL || 'http://localhost:3000';

// ---------------------------------------------------------------------------
// Admin token — cached at module level, with 429 back-off retry
// ---------------------------------------------------------------------------

// ROK-1085: globalSetup writes the JWT to scripts/.auth/admin-token.json so
// each Playwright worker can read the cached token instead of hammering
// /auth/local in parallel (the rate limiter rejected the fan-out and caused
// flaky smoke runs). Falls back to the live login if the file is absent.
//
// ROK-1149: tokens older than ~50 min are treated as missing (JWT default
// expiry is 1h). In practice this is inert — CI uses a fresh `.auth/` per
// run and a single Playwright invocation rarely exceeds 12 min — but it
// guards re-runs that reuse a stale on-disk token in long local sessions.
const TOKEN_MAX_AGE_MS = 50 * 60 * 1000;

let _cachedToken: string | null = null;
let _tokenPromise: Promise<string> | null = null;

async function readTokenFromDisk(): Promise<string | null> {
    try {
        const raw = await readFile(TOKEN_FILE_PATH, 'utf8');
        const parsed = JSON.parse(raw) as {
            access_token?: unknown;
            issued_at?: unknown;
        };
        if (typeof parsed.access_token !== 'string' || !parsed.access_token) {
            return null;
        }
        if (typeof parsed.issued_at === 'string') {
            const issuedMs = Date.parse(parsed.issued_at);
            if (
                !Number.isNaN(issuedMs) &&
                Date.now() - issuedMs > TOKEN_MAX_AGE_MS
            ) {
                return null;
            }
        }
        return parsed.access_token;
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

// ---------------------------------------------------------------------------
// Lineup creation with bounded retry on 409 (ROK-1167)
// ---------------------------------------------------------------------------

interface CreateLineupOpts {
    /** Max attempts including the first POST. Default 5. */
    attempts?: number;
    /** Pacing between attempts in ms. Default 1000. */
    delayMs?: number;
}

async function postLineup(token: string, body: Record<string, unknown>) {
    return fetch(`${API_BASE}/lineups`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
    });
}

async function resetLineupsByPrefix(token: string, workerPrefix: string) {
    await fetch(`${API_BASE}/admin/test/reset-lineups`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ titlePrefix: workerPrefix }),
    });
}

/**
 * POST /lineups with bounded retry on 409 collisions.
 *
 * When a sibling worker has just created a lineup, our POST returns 409.
 * We then call /admin/test/reset-lineups (prefix-scoped) to archive the
 * sibling's row, wait for the transaction to settle, and retry. Throws a
 * descriptive error after exhausting attempts.
 *
 * ROK-1167: replaces the ad-hoc 409 fallback in lineup-tiebreaker /
 * lineup-votes-per-player / paste-nominate fixtures.
 */
export async function createLineupOrRetry(
    token: string,
    body: Record<string, unknown>,
    workerPrefix: string,
    opts: CreateLineupOpts = {},
): Promise<{ id: number }> {
    const attempts = opts.attempts ?? 5;
    const delayMs = opts.delayMs ?? 1000;
    let lastStatus = 0;
    let lastText = '';
    for (let attempt = 0; attempt < attempts; attempt++) {
        const res = await postLineup(token, body);
        if (res.status === 201) {
            const json = (await res.json()) as { id: number };
            return { id: json.id };
        }
        lastStatus = res.status;
        lastText = await res.text().catch(() => '');
        if (res.status !== 409) {
            throw new Error(
                `createLineupOrRetry failed for prefix=${workerPrefix}; status=${lastStatus} body=${lastText}`,
            );
        }
        await resetLineupsByPrefix(token, workerPrefix);
        // Retry pacing for 409 collision recovery between server-side reset
        // and re-POST — not a UI assertion delay (test infra only).
        await new Promise((r) => setTimeout(r, delayMs));
    }
    throw new Error(
        `createLineupOrRetry exhausted ${attempts} attempts for prefix=${workerPrefix}; last status=${lastStatus} body=${lastText}`,
    );
}

// ---------------------------------------------------------------------------
// Async-write coordination helpers (ROK-1070)
// ---------------------------------------------------------------------------

/**
 * Drain all BullMQ queues and any buffered async writes so subsequent
 * assertions see the final post-write state. Thin wrapper around the
 * existing test-only endpoint `/admin/test/await-processing`.
 *
 * Use this after a write whose downstream side-effects (event listeners,
 * BullMQ jobs, embed-sync, notifications) must complete before the next
 * read. See `feedback_smoke_polling_for_async_writes.md`.
 */
export async function awaitProcessing(token: string): Promise<void> {
    await apiPost(token, '/admin/test/await-processing');
}

/**
 * Cancel all queued BullMQ phase-advance jobs for `lineupId`. Thin wrapper
 * around the existing test-only endpoint
 * `/admin/test/cancel-lineup-phase-jobs`. Used by smoke fixtures that need
 * to keep a lineup in a fixed phase regardless of the auto-advance schedule.
 */
export async function cancelLineupPhaseJobs(
    token: string,
    lineupId: number,
): Promise<void> {
    await apiPost(token, '/admin/test/cancel-lineup-phase-jobs', {
        lineupId,
    });
}
