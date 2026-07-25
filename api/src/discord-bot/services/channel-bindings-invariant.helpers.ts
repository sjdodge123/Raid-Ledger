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

/**
 * App-side game deletion that keeps the binding invariant intact (AC3).
 *
 * Deleting a game fires channel_bindings' FK ON DELETE SET NULL, which would
 * leave any game-voice-monitor binding inert. This helper OWNS the delete:
 * affected monitors are normalized to general-lobby — collision-aware, because
 * under ROK-1419's null-game unique index a channel can hold at most ONE
 * non-series (general-lobby, NULL) row. Per (guild, channel): if a lobby
 * already covers the channel, ALL affected monitors are redundant and are
 * removed; otherwise the first affected monitor becomes the lobby and the rest
 * are removed. Series monitors (outside the partial indexes) are normalized
 * in place. Raw-SQL / pg_restore / bulk paths bypass this by nature — that is
 * what the runtime tolerance + boot detection exist for.
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
      .where(
        and(
          inArray(cb.gameId, gameIds),
          eq(cb.bindingPurpose, 'game-voice-monitor'),
          eq(cb.channelType, 'voice'),
        ),
      );
    const { keepIds, dropIds } = await planNormalization(tx, affected);
    if (dropIds.length > 0) {
      await tx.delete(cb).where(inArray(cb.id, dropIds));
    }
    await tx.delete(schema.games).where(inArray(schema.games.id, gameIds));
    if (keepIds.length > 0) {
      await tx
        .update(cb)
        .set({ bindingPurpose: 'general-lobby', updatedAt: new Date() })
        .where(inArray(cb.id, keepIds));
    }
    for (const b of affected) {
      const action = keepIds.includes(b.id)
        ? 'normalized to general-lobby'
        : 'removed as redundant (a lobby already covers the channel)';
      logger.log(
        `[binding-guard] game-delete: binding=${b.id} channel=${b.channelId} ${action} (game ${b.gameId} deleted, ROK-1415)`,
      );
    }
  });
}

/** Per-channel collision plan: at most one non-series (lobby, NULL) survivor. */
async function planNormalization(
  tx: Pick<PostgresJsDatabase<typeof schema>, 'select'>,
  affected: (typeof schema.channelBindings.$inferSelect)[],
): Promise<{ keepIds: string[]; dropIds: string[] }> {
  const cb = schema.channelBindings;
  const keepIds: string[] = [];
  const dropIds: string[] = [];
  const byChannel = new Map<string, typeof affected>();
  for (const b of affected) {
    if (b.recurrenceGroupId != null) {
      // Series rows sit outside the partial unique indexes — no collision risk.
      keepIds.push(b.id);
      continue;
    }
    const key = `${b.guildId}:${b.channelId}`;
    byChannel.set(key, [...(byChannel.get(key) ?? []), b]);
  }
  for (const group of byChannel.values()) {
    const [first] = group;
    const [existingLobby] = await tx
      .select({ id: cb.id })
      .from(cb)
      .where(
        and(
          eq(cb.guildId, first.guildId),
          eq(cb.channelId, first.channelId),
          eq(cb.bindingPurpose, 'general-lobby'),
          isNull(cb.gameId),
          isNull(cb.recurrenceGroupId),
        ),
      )
      .limit(1);
    const survivors = existingLobby ? [] : [first.id];
    keepIds.push(...survivors);
    dropIds.push(
      ...group.map((b) => b.id).filter((id) => !survivors.includes(id)),
    );
  }
  return { keepIds, dropIds };
}
