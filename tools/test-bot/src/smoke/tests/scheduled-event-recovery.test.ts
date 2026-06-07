/**
 * Scheduled Event idempotency + orphan recovery smoke tests (ROK-1347).
 *
 * Validates the two production-freeze fixes end-to-end against a real guild:
 *   1. Idempotency — creating an event then running reconciliation twice leaves
 *      EXACTLY ONE guild SE with that title (no duplicate-per-tick growth).
 *   2. Recovery — when a duplicate SE exists (same title+start as the bound
 *      one), the operator recovery endpoint deletes the duplicate and leaves
 *      the bound copy intact; operator-owned SEs are never touched.
 *
 * The companion bot creates the duplicate/operator SEs directly via discord.js
 * (it has real guild access) to simulate the timeout-after-success orphan.
 */
import {
  GuildScheduledEventPrivacyLevel,
  GuildScheduledEventEntityType,
} from "discord.js";
import { getGuild } from "../../client.js";
import { pollForCondition } from "../../helpers/polling.js";
import {
  createEvent,
  deleteEvent,
  awaitProcessing,
  enableScheduledEvents,
  disableScheduledEvents,
  triggerReconciliation,
  recoverOrphanScheduledEvents,
} from "../fixtures.js";
import type { SmokeTest, TestContext } from "../types.js";

/** Count guild SEs whose name matches `title` exactly (HTTP fetch, not cache). */
async function countScheduledEventsByTitle(title: string): Promise<number> {
  const guild = getGuild();
  const events = await guild.scheduledEvents.fetch();
  return events.filter((se) => se.name === title).size;
}

/** Find one guild SE by exact title. */
async function findOneByTitle(
  title: string,
): Promise<{ id: string; name: string; start: number | null } | null> {
  const guild = getGuild();
  const events = await guild.scheduledEvents.fetch();
  const match = events.find((se) => se.name === title);
  if (!match) return null;
  return {
    id: match.id,
    name: match.name,
    start: match.scheduledStartTimestamp,
  };
}

/** Create a raw guild SE directly (simulates an orphan/duplicate). Returns id. */
async function createRawGuildSE(
  channelId: string,
  name: string,
  startMs: number,
  description?: string,
): Promise<string> {
  const guild = getGuild();
  const se = await guild.scheduledEvents.create({
    name,
    scheduledStartTime: new Date(startMs),
    scheduledEndTime: new Date(startMs + 3 * 60 * 60 * 1000),
    privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly,
    entityType: GuildScheduledEventEntityType.Voice,
    channel: channelId,
    description,
  });
  return se.id;
}

const reconciliationIsIdempotent: SmokeTest = {
  name: "ROK-1347: reconciliation creates exactly one SE even when run twice",
  category: "flow",
  async run(ctx: TestContext) {
    await enableScheduledEvents(ctx.api);
    const ev = await createEvent(ctx.api, "se-idem");
    try {
      await awaitProcessing(ctx.api);
      // Wait for the initial SE to appear. 2× the default timeout: SE creation
      // traverses reconciliation trigger → BullMQ → Discord API, and remote
      // envs (rl-infra fleet) need the headroom — 60s flaked 1-of-2 dogfood
      // runs while the assertion itself was sound (fix-batch 2026-06-06).
      await pollForCondition(
        async () =>
          (await countScheduledEventsByTitle(ev.title)) >= 1 ? true : null,
        ctx.config.timeoutMs * 2,
        { intervalMs: 2000 },
      );

      // Run reconciliation twice — the idempotent pre-check must NOT create a
      // second SE for the same event.
      await triggerReconciliation(ctx.api);
      await awaitProcessing(ctx.api);
      await triggerReconciliation(ctx.api);
      await awaitProcessing(ctx.api);

      const count = await countScheduledEventsByTitle(ev.title);
      if (count !== 1) {
        throw new Error(
          `Expected exactly 1 guild SE for "${ev.title}", found ${count}`,
        );
      }
    } finally {
      await disableScheduledEvents(ctx.api);
      await deleteEvent(ctx.api, ev.id);
    }
  },
};

const recoveryDeletesDuplicateKeepsBound: SmokeTest = {
  name: "ROK-1347: recovery deletes a duplicate SE, leaves the bound copy",
  category: "flow",
  async run(ctx: TestContext) {
    await enableScheduledEvents(ctx.api);
    const ev = await createEvent(ctx.api, "se-recover");
    let dupId: string | null = null;
    try {
      await awaitProcessing(ctx.api);
      const bound = await pollForCondition(
        () => findOneByTitle(ev.title),
        // 2× default — same remote-env headroom rationale as the idempotency
        // test's initial-SE poll above.
        ctx.config.timeoutMs * 2,
        { intervalMs: 2000 },
      );
      if (bound.start == null) {
        throw new Error("Bound SE has no start timestamp");
      }

      // Manually create a duplicate SE with the same title + start (the
      // timeout-after-success orphan). Reuse the bound SE's channel.
      const guild = getGuild();
      const boundSe = await guild.scheduledEvents.fetch(bound.id);
      const channelId = boundSe.channelId;
      if (!channelId) throw new Error("Bound SE has no channel to reuse");
      // Copy the bound SE's description so the duplicate carries the RL
      // fingerprint (/events/<id>) — recovery only reclaims fingerprinted
      // SEs (Codex P2 operator-safety guard); a real timeout-race duplicate
      // is RL-created and always has it.
      dupId = await createRawGuildSE(
        channelId,
        ev.title,
        bound.start,
        boundSe.description ?? undefined,
      );

      // Two SEs with this title now exist.
      const before = await countScheduledEventsByTitle(ev.title);
      if (before !== 2) {
        throw new Error(`Expected 2 SEs before recovery, found ${before}`);
      }

      // Execute recovery (dryRun=false).
      const result = await recoverOrphanScheduledEvents(ctx.api, false);
      if (result.deleted < 1) {
        throw new Error(
          `Recovery deleted ${result.deleted} SEs; expected ≥1 duplicate removed`,
        );
      }

      // Exactly one SE remains, and it is the BOUND copy (not the duplicate).
      await pollForCondition(
        async () =>
          (await countScheduledEventsByTitle(ev.title)) === 1 ? true : null,
        ctx.config.timeoutMs,
        { intervalMs: 2000 },
      );
      const remaining = await findOneByTitle(ev.title);
      if (!remaining || remaining.id !== bound.id) {
        throw new Error(
          `Bound SE ${bound.id} should survive; remaining=${remaining?.id ?? "none"}`,
        );
      }
      dupId = null; // duplicate was deleted by recovery
    } finally {
      // Clean up the duplicate if recovery didn't remove it.
      if (dupId) {
        await getGuild()
          .scheduledEvents.delete(dupId)
          .catch(() => null);
      }
      await disableScheduledEvents(ctx.api);
      await deleteEvent(ctx.api, ev.id);
    }
  },
};

export const scheduledEventRecoveryTests: SmokeTest[] = [
  reconciliationIsIdempotent,
  recoveryDeletesDuplicateKeepsBound,
];
