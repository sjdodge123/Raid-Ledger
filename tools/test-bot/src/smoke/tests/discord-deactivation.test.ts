/**
 * ROK-1260 — Discord deactivation smoke tests.
 *
 * Asserts the end-to-end behavior of the "user left the guild" pipeline
 * against a real Discord bot + API + Postgres:
 *
 *   1. Dispatching a Discord notification to a user who is NOT in the
 *      guild MUST trigger the processor's `permanent-deactivate` branch
 *      (50278) → service.deactivateUser(userId) → DB column flip + admin
 *      notification + signup cancel cascade.
 *   2. The BullMQ job MUST end up in the `completed` state — NOT
 *      `failed` — so Sentry's auto-instrumentation does not capture it.
 *   3. The user's `deactivated_at` MUST be set to a non-null timestamp.
 *   4. An admin in-app notification row MUST exist with type
 *      `user_deactivated_discord`.
 *   5. Any upcoming-event signup the user had MUST be soft-cancelled
 *      (status flipped to `declined` or `roached_out`).
 *
 * Today this test FAILS because
 *   - the production processor branch does not exist (50278 still
 *     re-throws and the job ends in `failed`),
 *   - the DB column does not exist,
 *   - the admin notification type does not exist,
 *   - and the dev-mode test endpoints below (`/admin/test/user-state`,
 *     `/admin/test/dispatch-discord-notification`, `/admin/test/seed-
 *     deactivation-fixture`) do not exist yet.
 *
 * IMPORTANT: this smoke test references test-only admin endpoints that
 * the dev needs to wire alongside the implementation. The proposed
 * endpoint contracts are documented inline so the dev can mirror them
 * 1:1 in `api/src/admin/demo-test-core.controller.ts`. See the
 * tdd-report-ROK-1260.md doc for the full list.
 */
import { pollForCondition } from '../../helpers/polling.js';
import { awaitProcessing, deleteEvent, createEvent, signupAs } from '../fixtures.js';
import type { SmokeTest, TestContext } from '../types.js';

// ── Proposed test-only API surface (dev to implement) ──────────────────────
//
// All three live under `/admin/test/*` (DEMO_MODE only). They are read-only
// or fixture-only — never used in production paths.

/**
 * GET /admin/test/user-state?userId=N
 * Returns `{ id, deactivatedAt: string | null, adminDeactivationNotificationCount: number }`.
 * The dev should add this to demo-test-core.controller.ts so the smoke
 * test can observe the deactivation transition end-to-end.
 */
interface UserStateResponse {
  id: number;
  deactivatedAt: string | null;
  adminDeactivationNotificationCount: number;
}

/**
 * POST /admin/test/dispatch-discord-notification
 * Body: `{ userId: number, type?: 'system' | ... }`. The endpoint MUST
 * forcibly invoke `DiscordNotificationService.dispatch()` for the given
 * user (bypassing rate-limit + dedup so the test always enqueues). Used
 * to provoke the 50278 path without piggy-backing on a real event flow.
 */
interface DispatchResponse {
  enqueued: boolean;
  notificationId: string;
}

/**
 * GET /admin/test/job-state?notificationId=...
 * Returns `{ state: 'waiting' | 'active' | 'completed' | 'failed' | 'unknown' }`.
 * Lets the smoke test assert the job did NOT end in `failed` after the
 * processor caught the 50278 and called `deactivateUser`.
 */
interface JobStateResponse {
  state: 'waiting' | 'active' | 'completed' | 'failed' | 'unknown';
}

/**
 * POST /admin/test/seed-non-guild-user
 * Body: `{ }`. Returns `{ userId, discordId }`. Creates a fresh user
 * with a syntactically-valid Discord snowflake that is NOT in the test
 * guild — this gives the smoke test a deterministic recipient for the
 * 50278 path without relying on environment-specific bot state.
 */
interface SeedNonGuildUserResponse {
  userId: number;
  discordId: string;
}

// ── Test 1: 50278 → deactivate + completed (no Sentry noise) ───────────────

const deactivatesAndCompletesJobOn50278: SmokeTest = {
  name: 'Discord 50278 → user deactivated, job completed (no Sentry capture)',
  category: 'dm',
  async run(ctx: TestContext) {
    // Seed a recipient that the bot cannot DM (no mutual guilds).
    const seed = await ctx.api.post<SeedNonGuildUserResponse>(
      '/admin/test/seed-non-guild-user',
      {},
    );

    // Trigger the dispatch — this enqueues a DM job that WILL throw
    // DiscordAPIError[50278] on the worker.
    const dispatched = await ctx.api.post<DispatchResponse>(
      '/admin/test/dispatch-discord-notification',
      { userId: seed.userId, simulate: 50278 },
    );

    // Drain BullMQ so the worker has finished retrying / running.
    await awaitProcessing(ctx.api);

    // Poll for the deactivation transition — the processor should have
    // flipped `deactivated_at` synchronously inside the catch branch.
    const finalState = await pollForCondition(
      async () => {
        const state = await ctx.api.get<UserStateResponse>(
          `/admin/test/user-state?userId=${seed.userId}`,
        );
        if (state.deactivatedAt !== null) return state;
        return null;
      },
      ctx.config.timeoutMs,
      { intervalMs: 1000 },
    );

    if (finalState.deactivatedAt === null) {
      throw new Error(
        `Expected deactivated_at to be non-null for user ${seed.userId}`,
      );
    }
    if (finalState.adminDeactivationNotificationCount < 1) {
      throw new Error(
        `Expected at least 1 admin "user_deactivated_discord" notification, got ${finalState.adminDeactivationNotificationCount}`,
      );
    }

    // Job state must be `completed`, NOT `failed` — proves the processor
    // swallowed the 50278 and Sentry's auto-instrumentation did not capture.
    const jobState = await ctx.api.get<JobStateResponse>(
      `/admin/test/job-state?notificationId=${dispatched.notificationId}`,
    );
    if (jobState.state !== 'completed') {
      throw new Error(
        `Expected job to be 'completed' (no Sentry capture), got '${jobState.state}'`,
      );
    }
  },
};

// ── Test 2: cancel-cascade → upcoming signups soft-cancelled ───────────────

const deactivationCancelsUpcomingSignups: SmokeTest = {
  name: 'Discord deactivation cancels upcoming signups via cancelSignup pipeline',
  category: 'dm',
  async run(ctx: TestContext) {
    const seed = await ctx.api.post<SeedNonGuildUserResponse>(
      '/admin/test/seed-non-guild-user',
      {},
    );
    const ev = await createEvent(ctx.api, 'deact-cascade');
    try {
      await signupAs(ctx.api, ev.id, seed.userId, ['dps']);
      await awaitProcessing(ctx.api);

      // Provoke deactivation.
      await ctx.api.post<DispatchResponse>(
        '/admin/test/dispatch-discord-notification',
        { userId: seed.userId, simulate: 50278 },
      );
      await awaitProcessing(ctx.api);

      // Poll until the signup is no longer in an `active` status.
      // We rely on the existing /admin/test/notifications endpoint
      // returning the user's row state — proxied through user-state.
      await pollForCondition(
        async () => {
          const state = await ctx.api.get<UserStateResponse>(
            `/admin/test/user-state?userId=${seed.userId}`,
          );
          return state.deactivatedAt ? state : null;
        },
        ctx.config.timeoutMs,
        { intervalMs: 1000 },
      );

      // Re-read the signup roster for the event — the deactivated user
      // should no longer appear as `going`/`maybe`/`bench`.
      // The existing /events/:id endpoint surfaces signups; if the dev
      // exposes a richer test-only endpoint, switch to that. Either way,
      // the deactivated user must NOT appear in any active slot.
      type EventDetail = {
        signups?: Array<{ userId: number; status: string }>;
      };
      const evDetail = await ctx.api.get<EventDetail>(`/events/${ev.id}`);
      const stillActive = (evDetail.signups ?? []).find(
        (s) =>
          s.userId === seed.userId &&
          !['declined', 'roached_out', 'departed'].includes(s.status),
      );
      if (stillActive) {
        throw new Error(
          `Upcoming signup for deactivated user is still active: status=${stillActive.status}`,
        );
      }
    } finally {
      await deleteEvent(ctx.api, ev.id);
    }
  },
};

// ── Test 3 (ROK-1354): 10013 Unknown User → deactivate + completed ─────────
//
// 10013 ("Unknown User") fires when the recipient's Discord account has been
// deleted — `client.users.fetch(discordId)` throws BEFORE `user.send`. The
// deleted account is gone for good, so the processor must treat it exactly
// like 50278: deactivate the user and let the job COMPLETE (no Sentry
// capture). Mirrors `deactivatesAndCompletesJobOn50278`, swapping the
// simulated code to 10013.
const deactivatesAndCompletesJobOn10013: SmokeTest = {
  name: 'Discord 10013 (Unknown User) → user deactivated, job completed (no Sentry capture)',
  category: 'dm',
  async run(ctx: TestContext) {
    const seed = await ctx.api.post<SeedNonGuildUserResponse>(
      '/admin/test/seed-non-guild-user',
      {},
    );

    // Trigger the dispatch — this enqueues a DM job that WILL throw
    // DiscordAPIError[10013] on the worker (deleted account).
    const dispatched = await ctx.api.post<DispatchResponse>(
      '/admin/test/dispatch-discord-notification',
      { userId: seed.userId, simulate: 10013 },
    );

    await awaitProcessing(ctx.api);

    const finalState = await pollForCondition(
      async () => {
        const state = await ctx.api.get<UserStateResponse>(
          `/admin/test/user-state?userId=${seed.userId}`,
        );
        if (state.deactivatedAt !== null) return state;
        return null;
      },
      ctx.config.timeoutMs,
      { intervalMs: 1000 },
    );

    if (finalState.deactivatedAt === null) {
      throw new Error(
        `Expected deactivated_at to be non-null for user ${seed.userId} after 10013`,
      );
    }
    if (finalState.adminDeactivationNotificationCount < 1) {
      throw new Error(
        `Expected at least 1 admin "user_deactivated_discord" notification, got ${finalState.adminDeactivationNotificationCount}`,
      );
    }

    const jobState = await ctx.api.get<JobStateResponse>(
      `/admin/test/job-state?notificationId=${dispatched.notificationId}`,
    );
    if (jobState.state !== 'completed') {
      throw new Error(
        `Expected job to be 'completed' (no Sentry capture) on 10013, got '${jobState.state}'`,
      );
    }
  },
};

export const discordDeactivationTests: SmokeTest[] = [
  deactivatesAndCompletesJobOn50278,
  deactivationCancelsUpcomingSignups,
  deactivatesAndCompletesJobOn10013,
];
