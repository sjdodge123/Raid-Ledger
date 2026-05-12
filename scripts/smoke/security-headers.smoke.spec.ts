/**
 * Security headers smoke test (ROK-1158).
 *
 * Asserts all 6 required security headers are present and valued correctly on:
 *   - `/` (SPA index.html)
 *   - `/api/health` (proxied API endpoint)
 *   - `/assets/<bundle>.js` (proves the static-asset location block doesn't
 *     drop headers via the nginx `add_header` inheritance trap — see
 *     architect-ROK-1158.md §2)
 *
 * Target env: nginx-fronted deploy (allinone container at :8080).
 *   BASE_URL=http://localhost:8080 npx playwright test scripts/smoke/security-headers.smoke.spec.ts
 *
 * On Vite dev (:5173, the default BASE_URL) the headers do not exist, so
 * this spec FAILS by design until the nginx + controller work for ROK-1158
 * lands and the test is run against the allinone container.
 */
import { test, expect } from './base';

const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';

const CSP_REQUIRED_SUBSTRINGS = [
    "default-src 'self'",
    'script-src',
    "frame-ancestors 'none'",
    'report-uri /api/csp-report',
];

async function assertSecurityHeaders(headers: Record<string, string>) {
    const csp = headers['content-security-policy'];
    expect(csp, 'Content-Security-Policy header missing').toBeTruthy();
    for (const substring of CSP_REQUIRED_SUBSTRINGS) {
        expect(csp, `CSP missing required substring: ${substring}`).toContain(substring);
    }

    expect(headers['strict-transport-security']).toBe('max-age=31536000; includeSubDomains');
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['x-frame-options']).toBe('DENY');
    expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');

    const permissions = headers['permissions-policy'];
    expect(permissions, 'Permissions-Policy header missing').toBeTruthy();
    expect(permissions).toContain('camera=()');
    expect(permissions).toContain('microphone=()');
    expect(permissions).toContain('geolocation=()');

    expect(headers['x-xss-protection'], 'X-XSS-Protection must be removed (deprecated)').toBeUndefined();
}

async function extractFirstBundleUrl(html: string): Promise<string | null> {
    const scriptMatch = html.match(/<script[^>]+src=["']([^"']*\/assets\/[^"']+\.js)["']/);
    if (scriptMatch) return scriptMatch[1];
    const moduleMatch = html.match(/["'](\/assets\/[A-Za-z0-9._-]+\.js)["']/);
    return moduleMatch ? moduleMatch[1] : null;
}

test.describe('Security headers on /', () => {
    test('GET / responds with all 6 security headers', async ({ request }) => {
        const response = await request.get(`${BASE_URL}/`);
        expect(response.status(), `GET ${BASE_URL}/ should succeed`).toBeLessThan(400);
        await assertSecurityHeaders(response.headers());
    });
});

test.describe('Security headers on /api/health', () => {
    test('GET /api/health responds with all 6 security headers', async ({ request }) => {
        const response = await request.get(`${BASE_URL}/api/health`);
        expect(response.status(), `GET ${BASE_URL}/api/health should succeed`).toBe(200);
        await assertSecurityHeaders(response.headers());
    });

    test('GET /api/health still returns {"status":"ok"} JSON body (no regression)', async ({ request }) => {
        const response = await request.get(`${BASE_URL}/api/health`);
        expect(response.status()).toBe(200);
        const body = await response.json();
        expect(body).toMatchObject({ status: 'ok' });
    });
});

test.describe('Security headers on /assets/*.js bundle', () => {
    test('static JS bundle response carries all 6 security headers', async ({ request }) => {
        const indexResponse = await request.get(`${BASE_URL}/`);
        expect(indexResponse.status(), `GET ${BASE_URL}/ should succeed`).toBeLessThan(400);
        const html = await indexResponse.text();

        const bundleUrl = await extractFirstBundleUrl(html);
        expect(
            bundleUrl,
            `index.html at ${BASE_URL}/ should reference a /assets/*.js bundle (Vite dev serves /src/main.tsx instead, which is the expected "failing first" state for ROK-1158)`,
        ).toBeTruthy();

        const absoluteBundleUrl = bundleUrl!.startsWith('http')
            ? bundleUrl!
            : `${BASE_URL}${bundleUrl}`;
        const bundleResponse = await request.get(absoluteBundleUrl);
        expect(bundleResponse.status(), `GET ${absoluteBundleUrl} should succeed`).toBe(200);
        await assertSecurityHeaders(bundleResponse.headers());
    });
});
