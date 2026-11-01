/** ROK-2056 — MSW route for `GET /companion/v1/devices` (the "is this viewer linked?" read). */
import { http, HttpResponse } from 'msw';
import type { CompanionDevice } from '@raid-ledger/contract';

export const COMPANION_DEVICES_URL = 'http://localhost:3000/companion/v1/devices';

/** One device row; `state` decides linked (`active`) vs not (`revoked`). */
export function buildCompanionDevice(over: Partial<CompanionDevice> = {}): CompanionDevice {
    return {
        id: 1, name: 'Gaming-PC', os: 'windows', osVersion: '11', appVersion: '0.1.0', tokenHint: 'ab12',
        createdAt: '2026-10-12T12:00:00.000Z', lastUsedAt: '2026-10-30T12:00:00.000Z',
        lastUsedNetwork: '203.0.113.x', revokedAt: null, state: 'active', ...over,
    };
}

/** Serves the given rows; `[]` = never linked. */
export function companionDevicesHandler(rows: CompanionDevice[]) {
    return http.get(COMPANION_DEVICES_URL, () => HttpResponse.json({ data: rows }));
}
