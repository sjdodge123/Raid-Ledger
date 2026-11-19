/**
 * ROK-2099 §5 — the `wow-addon-errors` v1 companion contract handler, owned
 * by the `blizzard` plugin. Runs IN the ingest tx: re-scrub every string
 * (D8) → server-side hash (D5) → one upsert on `(user_id, record_hash)`
 * keeping the widest view of each error (GREATEST count / last seen /
 * session / scrub count, LEAST first seen; provenance follows the latest
 * uploader). A re-upload of unchanged records changes
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

/** Rule 3: the uploader's own character + realm, when the collector sent them. */
function namesOf(payload: Payload): ScrubNames {
  return {
    character: payload.characterHint?.name,
    realm: payload.characterHint?.realm,
  };
}

/** The columns every row of one message shares. */
function batchColumns(
  ctx: Pick<CompanionHandlerContext, 'userId' | 'deviceId'>,
  payload: Payload,
) {
  return {
    userId: ctx.userId,
    deviceId: ctx.deviceId,
    accountKey: payload.accountKey,
    characterName: payload.characterHint?.name ?? null,
    characterRealm: payload.characterHint?.realm ?? null,
    source: payload.source,
    sourceVersion: payload.sourceVersion,
  };
}

/** One record → its scrubbed, hashed row (pure; exported for the spec). */
export function toAddonErrorRow(
  ctx: Pick<CompanionHandlerContext, 'userId' | 'deviceId'>,
  payload: Payload,
  rec: WowAddonErrorRecord,
): WowAddonErrorRecordInsert {
  const names = namesOf(payload);
  const addon = scrubText(rec.addon, WOW_ADDON_ERRORS_ADDON_MAX, names);
  const message = scrubText(rec.message, WOW_ADDON_ERRORS_MESSAGE_MAX, names);
  const stack =
    rec.stack === undefined
      ? null
      : scrubText(rec.stack, WOW_ADDON_ERRORS_STACK_MAX, names);
  return {
    ...batchColumns(ctx, payload),
    addon: addon.value,
    message: message.value,
    stack: stack?.value ?? null,
    recordHash: addonErrorRecordHash(
      addon.value,
      message.value,
      stack?.value ?? null,
    ),
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
 * twice, so collapse them first. The result is ordered by `recordHash` so two
 * concurrent uploads of one member take their row locks in the same order
 * (no `[A, B]` vs `[B, A]` deadlock).
 */
export function collapseByHash(
  rows: readonly WowAddonErrorRecordInsert[],
): WowAddonErrorRecordInsert[] {
  const byHash = new Map<string, WowAddonErrorRecordInsert>();
  for (const row of rows) {
    const held = byHash.get(row.recordHash);
    byHash.set(row.recordHash, held ? mergeRows(held, row) : row);
  }
  return [...byHash.values()].sort((a, b) =>
    a.recordHash < b.recordHash ? -1 : a.recordHash > b.recordHash ? 1 : 0,
  );
}

@Injectable()
export class WowAddonErrorsHandler implements CompanionInTxHandler<WowAddonErrorsMessage> {
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
          scrubbedCount: sql`GREATEST(${t.scrubbedCount}, excluded.scrubbed_count)`,
          // The row follows its latest uploader whole: provenance moves with
          // `device_id`, so revoking the old device strands none of its data.
          deviceId: sql`excluded.device_id`,
          accountKey: sql`excluded.account_key`,
          characterName: sql`excluded.character_name`,
          characterRealm: sql`excluded.character_realm`,
          source: sql`excluded.source`,
          sourceVersion: sql`excluded.source_version`,
          updatedAt: sql`now()`,
        },
      });
  }
}
