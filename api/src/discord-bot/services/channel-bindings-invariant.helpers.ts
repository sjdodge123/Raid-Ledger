/**
 * ROK-1415 — binding-triple invariant guard + app-side game-delete normalizer.
 *
 * A (voice, game-voice-monitor, gameId=NULL) binding is permanently inert:
 * getGameFilteredCount short-circuits to counted:0 and the spawn timer never
 * arms. The classifier lives in @raid-ledger/contract (shared with the admin
 * web form — the anti-drift guarantee); this module hosts the service-side
 * assert and the app-side normalization for game deletion.
 *
 * Extracted into its own file because channel-bindings.service.ts sits at the
 * 300-counted-line ESLint ceiling.
 */
import { BadRequestException, Logger } from '@nestjs/common';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import {
  classifyBindingTriple,
  deriveBindingPurpose,
  type BindingPurpose,
  type ChannelType,
} from '@raid-ledger/contract';

const guardLogger = new Logger('BindingInvariant');

/**
 * Assert the merged POST-WRITE triple is legal; WARN + throw 400 otherwise.
 * The thrown body ({message, code, field, errors[]}) passes untouched through
 * handleValidationError to the web client and the /bind error reply.
 */
export function assertValidBindingTriple(t: {
  channelType: ChannelType;
  bindingPurpose: BindingPurpose;
  gameId: number | null | undefined;
  guildId?: string;
  channelId?: string;
  bindingId?: string;
}): void {
  const v = classifyBindingTriple(t.channelType, t.bindingPurpose, t.gameId);
  if (!v) return;
  guardLogger.warn(
    `[binding-guard] rejected write code=${v.code} guild=${t.guildId ?? '?'} channel=${t.channelId ?? '?'} binding=${t.bindingId ?? '-'} type=${t.channelType} purpose=${t.bindingPurpose} gameId=${String(t.gameId)}`,
  );
  throw new BadRequestException({
    message: 'Invalid channel binding',
    code: v.code,
    field: v.field,
    errors: [`${v.field}: ${v.message}`],
  });
}

/** Site-A wrapper (upsert path): asserts the incoming opts triple. */
export function assertUpsertTriple(opts: {
  guildId: string;
  channelId: string;
  channelType: ChannelType;
  bindingPurpose: BindingPurpose;
  gameId: number | null;
}): void {
  assertValidBindingTriple({
    channelType: opts.channelType,
    bindingPurpose: opts.bindingPurpose,
    gameId: opts.gameId,
    guildId: opts.guildId,
    channelId: opts.channelId,
  });
}

/**
 * Site-B wrapper (updateConfig path): asserts the RESOLVED post-write triple.
 * ROK-1416 threads gameId by extending `patch` — the guard stays downstream of
 * any future field by construction.
 */
export function assertResolvedUpdateTriple(
  existing: {
    channelType: string;
    bindingPurpose: string;
    gameId: number | null;
    guildId: string;
    channelId: string;
  },
  patch: { bindingPurpose?: BindingPurpose },
  bindingId: string,
): void {
  assertValidBindingTriple({
    channelType: existing.channelType as ChannelType,
    bindingPurpose:
      patch.bindingPurpose ?? (existing.bindingPurpose as BindingPurpose),
    gameId: existing.gameId,
    guildId: existing.guildId,
    channelId: existing.channelId,
    bindingId,
  });
}

/** Moved out of ChannelBindingsService purely to free lines under the 300 cap. */
export function detectBehavior(
  channelType: ChannelType,
  gameId?: number | null,
): BindingPurpose {
  return deriveBindingPurpose(channelType, gameId);
}

type BindingLogger = Pick<Logger, 'log'>;

type BindingRow = typeof schema.channelBindings.$inferSelect;

/** The purpose a binding legally lands on once its game is nulled. */
function targetPurposeAfterNull(b: BindingRow): string {
  return b.channelType === 'voice' ? 'general-lobby' : 'game-announcements';
}

/**
 * App-side game deletion that keeps the binding invariant intact (AC3).
 *
 * Deleting a game fires channel_bindings' FK ON DELETE SET NULL. Two hazards:
 * a game-voice-monitor binding becomes permanently INERT (the ROK-1415
 * incident), and — under ROK-1419's null-game partial unique index — ANY
 * affected non-series row (monitor OR lobby-with-game OR text announcements)
 * that nulls into a (channel, purpose) slot already holding a null-game row
 * raises 23505 mid-delete. This helper OWNS the delete: per (guild, channel,
 * target-purpose) slot it keeps at most ONE null-game survivor — preferring an
 * untouched existing null-game row, then an affected row that already carries
 * the target purpose (no rewrite needed), then the first affected monitor
 * (purpose normalized to general-lobby after the delete) — and removes the
 * rest as redundant. Series rows sit outside the partial indexes: series
 * monitors are purpose-normalized in place, other series rows are left alone.
 * Raw-SQL / pg_restore / bulk paths bypass this by nature — that is what the
 * runtime tolerance + boot detection exist for.
 */
export async function normalizeAndDeleteGames(
  db: PostgresJsDatabase<typeof schema>,
  gameIds: number[],
  logger: BindingLogger = guardLogger,
): Promise<void> {
  if (gameIds.length === 0) return;
  const cb = schema.channelBindings;
  await db.transaction(async (tx) => {
    const affected = await tx
      .select()
      .from(cb)
      .where(inArray(cb.gameId, gameIds));
    const { keepIds, retargetIds, dropIds } = await planNormalization(
      tx,
      affected,
    );
    if (dropIds.length > 0) {
      await tx.delete(cb).where(inArray(cb.id, dropIds));
    }
    await tx.delete(schema.games).where(inArray(schema.games.id, gameIds));
    if (retargetIds.length > 0) {
      await tx
        .update(cb)
        .set({ bindingPurpose: 'general-lobby', updatedAt: new Date() })
        .where(inArray(cb.id, retargetIds));
    }
    for (const b of affected) {
      const action = dropIds.includes(b.id)
        ? 'removed as redundant (slot already covered)'
        : retargetIds.includes(b.id)
          ? 'normalized to general-lobby'
          : keepIds.includes(b.id)
            ? 'kept (game cleared, purpose already valid)'
            : 'left in place (series row outside the unique indexes)';
      logger.log(
        `[binding-guard] game-delete: binding=${b.id} channel=${b.channelId} ${action} (game ${b.gameId} deleted, ROK-1415)`,
      );
    }
  });
}

interface NormalizationPlan {
  /** Non-series survivors whose purpose is already the slot target. */
  keepIds: string[];
  /** Survivors needing a purpose rewrite to general-lobby (monitors). */
  retargetIds: string[];
  /** Redundant rows removed BEFORE the games delete (collision avoidance). */
  dropIds: string[];
}

/** Per (guild, channel, target-purpose) slot: at most one null-game survivor. */
async function planNormalization(
  tx: Pick<PostgresJsDatabase<typeof schema>, 'select'>,
  affected: BindingRow[],
): Promise<NormalizationPlan> {
  const cb = schema.channelBindings;
  const plan: NormalizationPlan = { keepIds: [], retargetIds: [], dropIds: [] };
  const bySlot = new Map<string, BindingRow[]>();
  for (const b of affected) {
    if (b.recurrenceGroupId != null) {
      // Series rows: no index collision possible; only monitors need repair.
      if (b.bindingPurpose === 'game-voice-monitor')
        plan.retargetIds.push(b.id);
      continue;
    }
    const key = `${b.guildId}:${b.channelId}:${targetPurposeAfterNull(b)}`;
    bySlot.set(key, [...(bySlot.get(key) ?? []), b]);
  }
  for (const group of bySlot.values()) {
    const [first] = group;
    const target = targetPurposeAfterNull(first);
    const [occupied] = await tx
      .select({ id: cb.id })
      .from(cb)
      .where(
        and(
          eq(cb.guildId, first.guildId),
          eq(cb.channelId, first.channelId),
          eq(cb.bindingPurpose, target),
          isNull(cb.gameId),
          isNull(cb.recurrenceGroupId),
        ),
      )
      .limit(1);
    let survivor: BindingRow | undefined;
    if (!occupied) {
      survivor = group.find((b) => b.bindingPurpose === target) ?? group[0];
      if (survivor.bindingPurpose === target) plan.keepIds.push(survivor.id);
      else plan.retargetIds.push(survivor.id);
    }
    plan.dropIds.push(
      ...group.map((b) => b.id).filter((id) => id !== survivor?.id),
    );
  }
  return plan;
}
