import { Logger } from '@nestjs/common';
import type { AddonMailworthy } from '@raid-ledger/contract';
import { mailworthyNameKey } from '../../../drizzle/schema/guild-mailworthy.name-key';
import type { AddonApplyContext } from './addon-import-apply.types';
import {
  clampGiver,
  clampedDate,
  dedupeGivers,
  giverSource,
  peerCutoff,
  peerRows,
  type MailworthyRoster,
} from './addon-import-char.mailworthy.helpers';
import {
  prunePeers,
  upsertGivers,
  upsertPeers,
  type MailworthyGiverRow,
} from './addon-import-char.mailworthy.writes';
import { resolveExportName } from './addon-import.binding-name';
import type { DecodedAddonCharExport } from './addon-import.decoder';

/**
 * ROK-2148 D.2 steps 5–6 — peers and givers. Givers off the latest roster
 * are rejected (logged); accepted ones carry the amended-D5 `source` and are
 * also recorded as peers at their own `asOf` (they ran Mailworthy).
 */

const logger = new Logger('AddonImportMailworthy');

export interface MailworthyListsInput {
  payload: DecodedAddonCharExport;
  block: AddonMailworthy;
  roster: MailworthyRoster;
  nowMs: number;
}

/** What the lists step did (feeds the import summary, ROK-2148 Q8). */
export interface MailworthyListsCounts {
  /** Giver rows actually written (a refused older report is not counted). */
  givers: number;
  giversRejected: number;
  peers: number;
}

/** The counts plus the accepted-giver total the outcome gate needs. */
export interface MailworthyListsResult {
  counts: MailworthyListsCounts;
  giversAccepted: number;
}

export async function applyMailworthyLists(
  ctx: AddonApplyContext,
  guildId: number,
  input: MailworthyListsInput,
): Promise<MailworthyListsResult> {
  const givers = acceptedGivers(ctx, guildId, input);
  const { block, nowMs } = input;
  const peers = peerRows(reportedPeers(input, givers), nowMs);
  await upsertPeers(ctx, guildId, peers);
  await prunePeers(ctx, guildId, peerCutoff(nowMs));
  const written = await upsertGivers(ctx, guildId, givers);
  const counts = {
    givers: written,
    giversRejected: dedupeGivers(block.givers ?? []).length - givers.length,
    peers: peers.length,
  };
  return { counts, giversAccepted: givers.length };
}

/**
 * The block's peers, the exporter (realm suffix stripped, the same name
 * rule as the binding, so its key matches the roster) and every accepted
 * giver at its own `asOf`.
 */
function reportedPeers(
  { payload, block }: MailworthyListsInput,
  givers: readonly MailworthyGiverRow[],
): { name: string; lastSeenAt: number }[] {
  const exporter = resolveExportName(payload.who);
  return [
    ...(block.peers ?? []),
    ...(exporter === ''
      ? []
      : [{ name: exporter, lastSeenAt: payload.exportedAt }]),
    ...givers.map((g) => ({
      name: g.characterName,
      lastSeenAt: Math.floor(g.asOf.getTime() / 1000),
    })),
  ];
}

/** Deduped, clamped, roster-checked giver rows with their source. */
function acceptedGivers(
  ctx: AddonApplyContext,
  guildId: number,
  { block, roster, nowMs }: MailworthyListsInput,
): MailworthyGiverRow[] {
  const generatedAt = clampedDate(block.generatedAt, nowMs);
  const rows: MailworthyGiverRow[] = [];
  for (const giver of dedupeGivers(block.givers ?? [])) {
    const nameKey = mailworthyNameKey(giver.characterName);
    const source = giverSource(nameKey, roster, ctx.userId);
    if (source === null) {
      logger.log(
        `mailworthy giver rejected: guild ${guildId} "${giver.characterName}" — not on latest roster`,
      );
      continue;
    }
    rows.push({
      nameKey,
      characterName: giver.characterName.trim(),
      ...clampGiver(giver),
      countingSince: clampedDate(giver.countingSince, nowMs),
      asOf: clampedDate(giver.asOf, nowMs),
      generatedAt,
      source,
    });
  }
  return rows;
}
