/**
 * Per-test isolation primitives for Playwright smoke tests.
 *
 * `TestWorld` owns a unique prefix derived from worker index + test title +
 * a monotonic counter. Every entity a test creates should embed `world.uid()`
 * (or `world.prefix`) in its name so that:
 *   1. parallel workers can never collide on a unique-constraint
 *   2. successive tests in the same worker don't share state
 *   3. an after-hook can wipe just this test's rows via prefix-scoped reset
 *
 * Used in tandem with the `world` fixture exposed by `./base.ts`.
 */
import type { TestInfo } from '@playwright/test';
import { apiPost, getAdminToken } from './api-helpers';

let monotonic = 0;

function slugifyTitle(s: string): string {
    const slug = s
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 30);
    return slug || 'test';
}

export class TestWorld {
    /** Per-test prefix, stable for this test's lifetime. */
    readonly prefix: string;
    private _token: string | null = null;

    constructor(testInfo: TestInfo) {
        const w = testInfo.workerIndex;
        const slug = slugifyTitle(testInfo.title);
        this.prefix = `smoke-w${w}-${slug}-${Date.now()}-${++monotonic}`;
    }

    /** Cached admin token for this test. */
    async token(): Promise<string> {
        if (!this._token) this._token = await getAdminToken();
        return this._token;
    }

    /**
     * Unique id scoped to this test. Multiple calls produce distinct values
     * (counter increments). Pass an optional suffix tag for readability —
     * e.g. `world.uid('event')` -> `smoke-w0-my-test-1714766400000-7-event-8`.
     */
    uid(tag = ''): string {
        const n = ++monotonic;
        return tag ? `${this.prefix}-${tag}-${n}` : `${this.prefix}-${n}`;
    }

    /**
     * Wipe rows this test created. Idempotent and prefix-scoped — never
     * touches rows the test didn't create. Errors are swallowed so a
     * partial-failure cleanup doesn't mask the real test failure.
     */
    async cleanup(): Promise<void> {
        const token = await this.token().catch(() => null);
        if (!token) return;
        await Promise.all([
            apiPost(token, '/admin/test/reset-lineups', {
                titlePrefix: this.prefix,
            }).catch(() => {}),
            apiPost(token, '/admin/test/reset-scheduled-events', {
                titlePrefix: this.prefix,
            }).catch(() => {}),
        ]);
    }
}
