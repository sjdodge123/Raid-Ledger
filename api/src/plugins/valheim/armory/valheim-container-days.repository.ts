/**
 * ROK-2014 — the containers' per-play-day snapshot writes (D5–D8). Every
 * statement runs on the importer's transaction, and none is wrapped in a
 * catch-and-retry: a failed statement poisons the whole postgres.js tx.
 * Zero totals are never inserted (the CHECK would abort the import) — an
 * item gone from the scan is deleted instead (D1).
 */
import { and, eq, lte, sql } from 'drizzle-orm';
import type { ValheimContainersMessage } from '@raid-ledger/contract';
import * as schema from '../../../drizzle/schema';
import type { ValheimLinkTx } from '../link/valheim-link-token-lock';
import type { ArmorySnapshot } from './valheim-armory.mappers';
import { chunked } from './valheim-containers.repository';
import {
  baseSegKey,
  dayBaseTotals,
  dayItemTotals,
  diffDay,
  itemSegKey,
  retentionCutoff,
  sameBaseRow,
  type DayBaseItemTotal,
  type DayItemTotal,
} from './valheim-container-days.helpers';
import { playDateIn, resolvePlayTimezone } from './valheim-skill-days.helpers';
import { selectServerTimezone } from './valheim-skill-days.repository';

const {
  valheimContainerDays: days,
  valheimContainerItemDays: items,
  valheimContainerBaseItemDays: baseItems,
} = schema;

/** Item rows: 6 params/row → 30 000; base rows: 9 → 45 000 (< 65 535). */
export const DAY_ROW_CHUNK = 5_000;

/** Which server-world-day a snapshot belongs to, and the scan's time. */
export interface ContainerDayRef {
  pelicanServerId: number;
  worldUid: string;
  playDate: string;
  capturedAt: Date;
}

/**
 * D5/D7: bucket a fresh scan on its play day (server tz → `defaultTz` →
 * UTC) and write that day's end-of-day totals. Returns the play date.
 */
export async function recordContainerDay(
  tx: ValheimLinkTx,
  snap: Pick<ArmorySnapshot, 'pelicanServerId'>,
  msg: ValheimContainersMessage,
  defaultTz: string | null,
): Promise<string> {
  const serverTz = await selectServerTimezone(tx, snap.pelicanServerId);
  const capturedAt = new Date(msg.capturedAt);
  const playDate = playDateIn(
    capturedAt,
    resolvePlayTimezone(serverTz, defaultTz),
  );
  const ref = { pelicanServerId: snap.pelicanServerId, playDate, capturedAt };
  await writeContainerDay(tx, { ...ref, worldUid: msg.worldUid }, msg);
  return playDate;
}

/**
 * D6/D8: upsert the day header, prune past retention, then diff-write the
 * day's item and base rows to `msg`'s totals. Also the demo seed's writer.
 */
export async function writeContainerDay(
  tx: ValheimLinkTx,
  ref: ContainerDayRef,
  msg: ValheimContainersMessage,
): Promise<void> {
  const dayId = await upsertDay(tx, ref);
  await pruneDays(tx, ref.pelicanServerId, ref.playDate);
  if (dayId === null) return;
  await syncItems(tx, dayId, dayItemTotals(msg));
  await syncBaseItems(tx, dayId, dayBaseTotals(msg));
}

/**
 * The day header; `last_captured_at` only moves forward. Null when a newer
 * scan already closed this day (cannot happen behind the scan's stale guard,
 * but then nothing is written rather than a newer picture overwritten).
 */
async function upsertDay(
  tx: ValheimLinkTx,
  ref: ContainerDayRef,
): Promise<number | null> {
  const [row] = await tx
    .insert(days)
    .values({
      pelicanServerId: ref.pelicanServerId,
      worldUid: ref.worldUid,
      playDate: ref.playDate,
      firstCapturedAt: ref.capturedAt,
      lastCapturedAt: ref.capturedAt,
    })
    .onConflictDoUpdate({
      target: [days.pelicanServerId, days.worldUid, days.playDate],
      set: { lastCapturedAt: sql`excluded.last_captured_at` },
      setWhere: sql`${days.lastCapturedAt} <= excluded.last_captured_at`,
    })
    .returning({ id: days.id });
  return row?.id ?? null;
}

/** D8: drop the server's days ≥ 30 calendar days old; rows cascade. */
async function pruneDays(
  tx: ValheimLinkTx,
  pelicanServerId: number,
  playDate: string,
): Promise<void> {
  await tx
    .delete(days)
    .where(
      and(
        eq(days.pelicanServerId, pelicanServerId),
        lte(days.playDate, retentionCutoff(playDate)),
      ),
    );
}

/** One `DELETE … WHERE id = ANY($1)` with the ids as ONE array parameter. */
function idsParam(ids: readonly number[]) {
  return sql`ANY(${`{${ids.join(',')}}`}::bigint[])`;
}

async function syncItems(
  tx: ValheimLinkTx,
  dayId: number,
  desired: ReadonlyMap<string, DayItemTotal>,
): Promise<void> {
  const existing = await tx
    .select({
      id: items.id,
      prefab: items.prefab,
      vehicle: items.vehicle,
      owner: items.owner,
      total: items.total,
    })
    .from(items)
    .where(eq(items.dayId, dayId));
  const { upserts, deleteIds } = diffDay<DayItemTotal>(
    existing,
    desired,
    itemSegKey,
  );
  for (const chunk of chunked(upserts, DAY_ROW_CHUNK)) {
    await tx
      .insert(items)
      .values(chunk.map((r) => ({ ...r, dayId })))
      .onConflictDoUpdate({
        target: [items.dayId, items.prefab, items.vehicle, items.owner],
        set: { total: sql`excluded.total` },
      });
  }
  if (deleteIds.length === 0) return;
  await tx.delete(items).where(sql`${items.id} = ${idsParam(deleteIds)}`);
}

async function syncBaseItems(
  tx: ValheimLinkTx,
  dayId: number,
  desired: ReadonlyMap<string, DayBaseItemTotal>,
): Promise<void> {
  const B = baseItems;
  const existing = await tx
    .select({
      id: B.id,
      baseKey: B.baseKey,
      baseX: B.baseX,
      baseZ: B.baseZ,
      prefab: B.prefab,
      vehicle: B.vehicle,
      owner: B.owner,
      total: B.total,
    })
    .from(B)
    .where(eq(B.dayId, dayId));
  const diff = diffDay<DayBaseItemTotal>(
    existing,
    desired,
    baseSegKey,
    sameBaseRow,
  );
  for (const chunk of chunked(diff.upserts, DAY_ROW_CHUNK)) {
    await tx
      .insert(B)
      .values(chunk.map((r) => ({ ...r, dayId })))
      .onConflictDoUpdate({
        target: [B.dayId, B.baseKey, B.prefab, B.vehicle, B.owner],
        set: {
          total: sql`excluded.total`,
          baseX: sql`excluded.base_x`,
          baseZ: sql`excluded.base_z`,
        },
      });
  }
  if (diff.deleteIds.length === 0) return;
  await tx.delete(B).where(sql`${B.id} = ${idsParam(diff.deleteIds)}`);
}
