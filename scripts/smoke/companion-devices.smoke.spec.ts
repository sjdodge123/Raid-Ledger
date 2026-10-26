/**
 * ROK-1955 — Companion device link + Devices card smoke (desktop + mobile).
 *
 * T-E2E-1: a link started through the public `POST /companion/v1/devices/link`
 * (what the Companion app does — no fixture endpoint) is approved on `/link`
 * by the signed-in admin, and the app's poll then returns an `rlcd_` token.
 * T-E2E-2: a device linked through the API is removed on My Integrations and
 * its row turns "Removed", under default-dark and default-light.
 *
 * Every device a test links is revoked in `finally`, so reruns on a preserved
 * env never reach the 10-device cap.
 */
import type { TestInfo } from '@playwright/test';
import { CompanionLinkPollSuccessSchema, CompanionLinkStartResponseSchema } from '@raid-ledger/contract';
import type { CompanionLinkPollSuccess, CompanionLinkStartResponse } from '@raid-ledger/contract';
import { test, expect } from './base';
import { API_BASE, apiDelete, apiPost, getAdminToken, pollForCondition } from './api-helpers';
import { useDarkScheme, useLightScheme } from './axe-contrast';

const LINK = '/companion/v1/devices/link';
const TOKEN_RE = /^rlcd_[A-Za-z0-9_-]{43}$/;

/** A display-safe, per-run device name (≤64 chars). */
function deviceName(testInfo: TestInfo, tag: string): string {
    return `Smoke-${tag}-${testInfo.project.name}-${Date.now()}`.slice(0, 64);
}

/** Start a link as the Companion app would: public, no auth. */
async function startLink(name: string): Promise<CompanionLinkStartResponse> {
    const res = await fetch(`${API_BASE}${LINK}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ device: { name, os: 'windows', osVersion: '11', appVersion: '0.1.0' } }),
    });
    expect(res.status, 'POST /companion/v1/devices/link').toBe(200);
    return CompanionLinkStartResponseSchema.parse(await res.json());
}

/** Poll until the link is approved and the token is minted. */
async function pollForToken(start: CompanionLinkStartResponse): Promise<CompanionLinkPollSuccess> {
    return pollForCondition(async () => {
        const res = await fetch(`${API_BASE}${LINK}/poll`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ deviceCode: start.deviceCode }),
        });
        const parsed = CompanionLinkPollSuccessSchema.safeParse(await res.json());
        return res.ok && parsed.success ? parsed.data : null;
    }, { timeoutMs: 30_000, intervalMs: (start.interval + 1) * 1000, description: 'companion link poll returns a token' });
}

/** Link a device end to end through the API (start → admin approves → poll). */
async function seedLinkedDevice(token: string, name: string): Promise<CompanionLinkPollSuccess> {
    const start = await startLink(name);
    const decision = await apiPost(token, `${LINK}/decision`, { userCode: start.userCode, decision: 'approve' });
    expect(decision, 'admin approves the seeded link').toMatchObject({ status: 'approved' });
    return pollForToken(start);
}

test.describe('Companion device link (ROK-1955 T-E2E-1)', () => {
    test('approving a code on /link lets the app poll a token', async ({ page }, testInfo) => {
        const adminToken = await getAdminToken();
        const name = deviceName(testInfo, 'link');
        const start = await startLink(name);
        let deviceId: number | null = null;
        try {
            await page.goto(`/link#code=${start.userCode}`);
            await expect(page.getByRole('textbox', { name: 'Device name' })).toHaveValue(name, { timeout: 15_000 });
            await page.getByRole('button', { name: 'Approve', exact: true }).click();
            await expect(page.getByText(/Return to your computer/)).toBeVisible({ timeout: 15_000 });
            const success = await pollForToken(start);
            deviceId = success.device.id;
            expect(success.token).toMatch(TOKEN_RE);
        } finally {
            if (deviceId !== null) await apiDelete(adminToken, `/companion/v1/devices/${deviceId}`);
        }
    });
});

for (const scheme of ['dark', 'light'] as const) {
    test.describe(`Companion devices card — default-${scheme} (ROK-1955 T-E2E-2)`, () => {
        test('removing a device turns its row Removed', async ({ page }, testInfo) => {
            const adminToken = await getAdminToken();
            const name = deviceName(testInfo, scheme);
            const linked = await seedLinkedDevice(adminToken, name);
            try {
                await (scheme === 'dark' ? useDarkScheme(page) : useLightScheme(page));
                await page.goto('/profile/integrations#companion-devices');
                const row = page.getByTestId(`companion-device-${linked.device.id}`);
                await expect(row.getByText('Active', { exact: true })).toBeVisible({ timeout: 15_000 });
                await row.getByRole('button', { name: 'Remove', exact: true }).click();
                await expect(page.getByText(`Remove ${name}? It stops uploading immediately`, { exact: false })).toBeVisible();
                await page.getByTestId('companion-device-confirm-remove').click();
                await expect(row.getByText('Removed', { exact: true })).toBeVisible({ timeout: 15_000 });
                await expect(row.getByRole('button')).toHaveCount(0);
            } finally {
                await apiDelete(adminToken, `/companion/v1/devices/${linked.device.id}`);
            }
        });
    });
}
