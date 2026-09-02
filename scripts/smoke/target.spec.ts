/**
 * Unit tests for the smoke-harness target resolution — ROK-1466.
 *
 * The bug these pin: a fleet run exported only PLAYWRIGHT_BASE_URL, so the
 * browser drove the env while global setup authenticated against
 * http://localhost:3000 (nothing listens there inside a runner container) and
 * global setup's own page.goto went to http://localhost:5173.
 */
import { describe, it, expect } from 'vitest';
import {
    DEFAULT_API_URL,
    DEFAULT_WEB_URL,
    isRemoteTarget,
    resolveApiUrl,
    resolveWebUrl,
} from './target';

const ENV_URL = 'http://rl-env-rok-1453-allinone';

describe('resolveWebUrl', () => {
    it('falls back to the local Vite dev server', () => {
        expect(resolveWebUrl({})).toBe(DEFAULT_WEB_URL);
    });

    it('prefers BASE_URL over PLAYWRIGHT_BASE_URL', () => {
        expect(
            resolveWebUrl({
                BASE_URL: ENV_URL,
                PLAYWRIGHT_BASE_URL: 'https://slot-9.gamernight.net',
            }),
        ).toBe(ENV_URL);
    });

    it('honours PLAYWRIGHT_BASE_URL when BASE_URL is absent', () => {
        expect(resolveWebUrl({ PLAYWRIGHT_BASE_URL: ENV_URL })).toBe(ENV_URL);
    });

    it('treats an empty string as unset', () => {
        expect(resolveWebUrl({ BASE_URL: '' })).toBe(DEFAULT_WEB_URL);
    });

    it('strips trailing slashes so joins never double up', () => {
        expect(resolveWebUrl({ BASE_URL: `${ENV_URL}/` })).toBe(ENV_URL);
    });
});

describe('resolveApiUrl', () => {
    it('falls back to the local Nest dev server', () => {
        expect(resolveApiUrl({})).toBe(DEFAULT_API_URL);
    });

    it('derives <BASE_URL>/api for a remote target', () => {
        expect(resolveApiUrl({ BASE_URL: ENV_URL })).toBe(`${ENV_URL}/api`);
    });

    it('derives from PLAYWRIGHT_BASE_URL too', () => {
        expect(resolveApiUrl({ PLAYWRIGHT_BASE_URL: ENV_URL })).toBe(
            `${ENV_URL}/api`,
        );
    });

    it('does not double the slash when BASE_URL ends in one', () => {
        expect(resolveApiUrl({ BASE_URL: `${ENV_URL}/` })).toBe(`${ENV_URL}/api`);
    });

    it('lets an explicit API_URL win over the derived one', () => {
        expect(
            resolveApiUrl({ BASE_URL: ENV_URL, API_URL: 'http://other/api' }),
        ).toBe('http://other/api');
    });

    it('keeps :3000 when the web target is the local default', () => {
        expect(resolveApiUrl({ BASE_URL: DEFAULT_WEB_URL })).toBe(DEFAULT_API_URL);
    });
});

describe('isRemoteTarget', () => {
    it('is false for an unconfigured environment', () => {
        expect(isRemoteTarget({})).toBe(false);
    });

    it('is true for a fleet env hostname', () => {
        expect(isRemoteTarget({ BASE_URL: ENV_URL })).toBe(true);
    });

    it('is true for a local allinone container on :80', () => {
        expect(isRemoteTarget({ BASE_URL: 'http://localhost:80' })).toBe(true);
    });
});
