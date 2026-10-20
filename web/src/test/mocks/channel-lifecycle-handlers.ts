/**
 * ROK-1428 (L7) — default channel-lifecycle admin handlers + factories. The
 * shapes mirror `packages/contract/src/channel-lifecycle.schema.ts` exactly;
 * specs override per case with `server.use()`.
 */
import { http, HttpResponse } from 'msw';
import type {
    ChannelLifecycleSettingsDto, GameLifecycleActivityDto, GameLifecycleActivityListDto,
    LifecycleSuppressionListDto, ReconcileResultDto,
} from '@raid-ledger/contract';

export const LIFECYCLE_API = 'http://localhost:3000/admin/discord/lifecycle';
export const BOT_SETTINGS_API = 'http://localhost:3000/admin/settings/discord-bot';
export const CATEGORIES_API = `${BOT_SETTINGS_API}/ephemeral-voice/categories`;

/** Lifecycle settings at the contract defaults, automation off. */
export function buildLifecycleSettings(overrides: Partial<ChannelLifecycleSettingsDto> = {}): ChannelLifecycleSettingsDto {
    return {
        enabled: false, recentActivityDays: 30, createThreshold: 2, gamesCategoryId: null,
        archiveCategoryId: null, hideOnArchive: false, maxChangesPerTick: 10, lastRunAt: null,
        lastRunError: null, ...overrides,
    };
}

/** One game's activity row; defaults to a quiet game with no binding. */
export function buildLifecycleActivity(overrides: Partial<GameLifecycleActivityDto> = {}): GameLifecycleActivityDto {
    return {
        gameId: 1, gameName: 'Baldur’s Gate 3', gameSlug: 'baldurs-gate-3', signals: [], itemCount: 0,
        lastActivityAt: null, hubHold: false, suppressed: false, binding: null, action: 'none',
        reason: 'No activity', ...overrides,
    };
}

export function buildActivityList(items: GameLifecycleActivityDto[]): GameLifecycleActivityListDto {
    return { items, windowDays: 30, generatedAt: '2026-10-20T12:00:00.000Z' };
}

/** A reconcile result with zero counts; override the counts / items per case. */
export function buildReconcileResult(overrides: Partial<ReconcileResultDto> = {}): ReconcileResultDto {
    return {
        dryRun: true, created: 0, unarchived: 0, archived: 0, linkedHubs: 0, skipped: 0, failed: 0,
        deferred: 0, stoppedReason: null, items: [], ...overrides,
    };
}

const NO_SUPPRESSIONS: LifecycleSuppressionListDto = { items: [] };

export const channelLifecycleHandlers = [
    http.get(`${LIFECYCLE_API}/settings`, () => HttpResponse.json(buildLifecycleSettings())),
    http.patch(`${LIFECYCLE_API}/settings`, async ({ request }) =>
        HttpResponse.json(buildLifecycleSettings((await request.json()) as Partial<ChannelLifecycleSettingsDto>))),
    http.get(`${LIFECYCLE_API}/activity`, () => HttpResponse.json(buildActivityList([]))),
    http.post(`${LIFECYCLE_API}/reconcile`, () => HttpResponse.json(buildReconcileResult())),
    http.get(`${LIFECYCLE_API}/suppressions`, () => HttpResponse.json(NO_SUPPRESSIONS)),
    http.delete(`${LIFECYCLE_API}/suppressions/:gameId`, () => new HttpResponse(null, { status: 204 })),
    http.get(CATEGORIES_API, () => HttpResponse.json([])),
];
