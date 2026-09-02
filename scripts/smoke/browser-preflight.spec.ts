/**
 * Unit tests for the browser-drift hint — ROK-1466.
 *
 * The runner image bakes the browsers for ITS Playwright minor; the repo pins
 * a newer one. The failure arrived as a `browserType.launch` stack pointing at
 * globalSetup, which reads like a harness bug rather than image drift.
 */
import { describe, it, expect } from 'vitest';
import { browserSetupHint } from './browser-preflight';

const DRIFT = new Error(
    "browserType.launch: Executable doesn't exist at " +
        '/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell',
);

describe('browserSetupHint', () => {
    it('names the remedy for a missing browser build', () => {
        const hint = browserSetupHint(DRIFT);
        expect(hint).toContain('npx playwright install chromium');
    });

    it('quotes the path Playwright looked in', () => {
        expect(browserSetupHint(DRIFT)).toContain('chromium_headless_shell-1234');
    });

    it('returns null for an unrelated error so it is not swallowed', () => {
        expect(browserSetupHint(new Error('connect ECONNREFUSED 127.0.0.1:3000'))).toBeNull();
    });

    it('tolerates a non-Error throwable', () => {
        expect(browserSetupHint('boom')).toBeNull();
    });
});
