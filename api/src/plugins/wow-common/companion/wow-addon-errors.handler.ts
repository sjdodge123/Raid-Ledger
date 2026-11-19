/**
 * ROK-2099 §5 — the `wow-addon-errors` v1 companion contract handler, owned
 * by the `blizzard` plugin. Runs IN the ingest tx: re-scrub every string
 * (D8) → server-side hash (D5) → one upsert on `(user_id, record_hash)`
 * keeping the widest view of each error (GREATEST count / last seen /
 * session, LEAST first seen). A re-upload of unchanged records changes
 * nothing and still acks `accepted` (AC1). No `latestWins`: the upsert is
 * idempotent on its own. Rows stay when the member turns the upload off
 * (ruling 8); retention and revoke cleanup are S2b.
 */
import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  WOW_ADDON_ERRORS_MESSAGE_MAX,
  WOW_ADDON_ERRORS_STACK_MAX,
  WOW_ADDON_ERRORS_ADDON_MAX,
  type WowAddonErrorRecord,
  type WowAddonErrorsMessage,
} from '@raid-ledger/contract';
import type {
  CompanionHandlerContext,
  CompanionInTxHandler,
} from '../../../companion/ingest/companion-handler.registry';
import type { CompanionIngestVia } from '../../../companion/ingest/companion-ingest-request';
import {
  wowAddonErrorRecords,
  type WowAddonErrorRecordInsert,
} from '../../../drizzle/schema/wow-addon-errors';
import {
  addonErrorRecordHash,
  scrubText,
  type ScrubNames,
} from './wow-addon-errors.scrub';

type Payload = WowAddonErrorsMessage['payload'];

/** One record → its scrubbed, hashed row (pure; exported for the spec). */
export function toAddonErrorRow(
  ctx: Pick<CompanionHandlerContext, 'userId' | 'deviceId'>,
  payload: Payload,
  rec: WowAddonErrorRecord,
): WowAddonErrorRecordInsert {
  const names: ScrubNames = {
    character: payload.characterHint?.name,
    realm: payload.characterHint?.realm,
  };
  const addon = scrubText(rec.addon, WOW_ADDON_ERRORS_ADDON_MAX, names);
  const message = scrubText(rec.message, WOW_ADDON_ERRORS_MESSAGE_MAX, names);
  const stack =
    rec.stack === undefined
      ? null
      : scrubText(rec.stack, WOW_ADDON_ERRORS_STACK_MAX, names);
  return {
    userId: ctx.userId,
    deviceId: ctx.deviceId,
    accountKey: payload.accountKey,
    characterName: payload.characterHint?.name ?? null,
    characterRealm: payload.characterHint?.realm ?? null,
    source: payload.source,
    sourceVersion: payload.sourceVersion,
    addon: addon.value,
    message: message.value,
    stack: stack?.value ?? null,
    recordHash: addonErrorRecordHash(addon.value, message.value, stack?.value ?? null),
    count: rec.count,
    session: rec.session ?? null,
    firstSeenAt: new Date(rec.firstSeenAt),
    lastSeenAt: new Date(rec.lastSeenAt),
    scrubbedCount: addon.replaced + message.replaced + (stack?.replaced ?? 0),
  };
}

const maxOf = (a: number | null | undefined, b: number | null | undefined) =>
  a == null ? (b ?? null) : b == null ? a : Math.max(a, b);

/** Merge two rows with the same hash the way the upsert would. */
function mergeRows(
  a: WowAddonErrorRecordInsert,
  b: WowAddonErrorRecordInsert,
): WowAddonErrorRecordInsert {
  return {
    ...a,
    count: Math.max(a.count, b.count),
    session: maxOf(a.session, b.session),
    firstSeenAt: a.firstSeenAt < b.firstSeenAt ? a.firstSeenAt : b.firstSeenAt,
    lastSeenAt: a.lastSeenAt > b.lastSeenAt ? a.lastSeenAt : b.lastSeenAt,
    scrubbedCount: Math.max(a.scrubbedCount ?? 0, b.scrubbedCount ?? 0),
  };
}

/**
 * Records distinct on the wire can collide after the scrub (e.g. two
 * character names → `<char>`); one INSERT … ON CONFLICT cannot touch a row
 * twice, so collapse them first.
 */
export function collapseByHash(
  rows: readonly WowAddonErrorRecordInsert[],
): WowAddonErrorRecordInsert[] {
  const byHash = new Map<string, WowAddonErrorRecordInsert>();
  for (const row of rows) {
    const held = byHash.get(row.recordHash);
    byHash.set(row.recordHash, held ? mergeRows(held, row) : row);
  }
  return [...byHash.values()];
}

@Injectable()
export class WowAddonErrorsHandler
  implements CompanionInTxHandler<WowAddonErrorsMessage>
{
  /** A literal: the ownership guard's scan reads it (`WOW_ADDON_ERRORS_CONTRACT_ID`). */
  readonly contract = 'wow-addon-errors';
  readonly versions: readonly number[] = [1];
  /** D3: the collector is the only producer — no browser paste path. */
  readonly sources: readonly CompanionIngestVia[] = ['device'];

  async handle(
    ctx: CompanionHandlerContext,
    msg: WowAddonErrorsMessage,
  ): Promise<void> {
    const rows = collapseByHash(
      msg.payload.records.map((rec) => toAddonErrorRow(ctx, msg.payload, rec)),
    );
    const t = wowAddonErrorRecords;
    await ctx.tx
      .insert(t)
      .values(rows)
      .onConflictDoUpdate({
        target: [t.userId, t.recordHash],
        set: {
          count: sql`GREATEST(${t.count}, excluded.count)`,
          lastSeenAt: sql`GREATEST(${t.lastSeenAt}, excluded.last_seen_at)`,
          firstSeenAt: sql`LEAST(${t.firstSeenAt}, excluded.first_seen_at)`,
          session: sql`GREATEST(${t.session}, excluded.session)`,
          deviceId: sql`excluded.device_id`,
          updatedAt: sql`now()`,
        },
      });
  }
}
