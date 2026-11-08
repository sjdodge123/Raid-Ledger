import { Logger } from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { AddonMailworthy } from '@raid-ledger/contract';
import { characters, guildMembers, guilds } from '../../../drizzle/schema';
import { mailworthyNameKey } from '../../../drizzle/schema/guild-mailworthy.name-key';
import {
  characterLink,
  inLatestSnapshot,
} from '../guilds/guild-membership.helpers';
import {
  guildNameKey,
  type AddonApplyContext,
} from './addon-import-apply.types';
import { applyChar } from './addon-import-char.apply';
import {
  clampedDate,
  dedupeRules,
  templateRejection,
  type MailworthyRoster,
} from './addon-import-char.mailworthy.helpers';
import { applyMailworthyLists } from './addon-import-char.mailworthy.lists';
import { upsertTemplate } from './addon-import-char.mailworthy.writes';
import { exportClock } from './addon-import.clock';
import type { DecodedAddonCharExport } from './addon-import.decoder';

/**
 * ROK-2148 D.2 — apply the `char` export's Mailworthy block (lifted to
 * `payload.mailworthy` by the decoder) to its guild's template / peers /
 * givers. Runs after `applyChar` in the same transaction whatever its
 * status; never throws for block content — a skip or a rejected row is
 * logged. Dry runs never reach it.
 */

const logger = new Logger('AddonImportMailworthy');

/** `applyChar`, then the Mailworthy block (non-dry char branch). */
export async function applyCharThenMailworthy(
  ctx: AddonApplyContext,
  payload: DecodedAddonCharExport,
): Promise<Awaited<ReturnType<typeof applyChar>>> {
  const outcome = await applyChar(ctx, payload);
  await applyCharMailworthy(ctx, payload);
  return outcome;
}

export async function applyCharMailworthy(
  ctx: AddonApplyContext,
  payload: DecodedAddonCharExport,
): Promise<void> {
  const block = payload.mailworthy;
  const guildName = payload.who.guildName;
  if (!block || !guildName) return;
  const guildId = await findGuildId(ctx, guildName);
  if (guildId === undefined) {
    logger.log('mailworthy skipped: no guild');
    return;
  }
  const roster = await loadRoster(ctx, guildId, payload.who.guid);
  if (roster.exporterKey === undefined) {
    logger.log(
      `mailworthy skipped: guild ${guildId} exporter not in latest roster`,
    );
    return;
  }
  const nowMs = exportClock.nowMs();
  await applyTemplate(ctx, guildId, block, roster, nowMs);
  await applyMailworthyLists(ctx, guildId, { payload, block, roster, nowMs });
}

/** The realm-less guild the guild section writes (`applyGuild`'s target). */
async function findGuildId(
  ctx: AddonApplyContext,
  guildName: string,
): Promise<number | undefined> {
  const [row] = await ctx.tx
    .select({ id: guilds.id })
    .from(guilds)
    .where(
      and(
        eq(guilds.gameId, ctx.gameId),
        eq(guilds.region, ctx.region),
        eq(guilds.nameKey, guildNameKey(guildName)),
        isNull(guilds.realmSlug),
        eq(guilds.kind, 'wow_guild'),
      ),
    )
    .limit(1);
  return row?.id;
}

/** Latest-snapshot members by name key, with every linked owner. */
async function loadRoster(
  ctx: AddonApplyContext,
  guildId: number,
  exporterGuid: string,
): Promise<MailworthyRoster> {
  const rows = await ctx.tx
    .select({
      name: guildMembers.characterName,
      rankIndex: guildMembers.rankIndex,
      guid: guildMembers.guid,
      ownerUserId: characters.userId,
    })
    .from(guildMembers)
    .innerJoin(guilds, eq(guilds.id, guildMembers.guildId))
    .leftJoin(characters, characterLink() ?? sql`false`)
    .where(and(eq(guildMembers.guildId, guildId), inLatestSnapshot()));
  const roster: MailworthyRoster = { byKey: new Map(), exporterKey: undefined };
  for (const row of rows) {
    const key = mailworthyNameKey(row.name);
    const entry = roster.byKey.get(key) ?? {
      rankIndex: null,
      ownerUserIds: [],
    };
    entry.rankIndex = bestRank(entry.rankIndex, row.rankIndex);
    if (row.ownerUserId !== null) entry.ownerUserIds.push(row.ownerUserId);
    roster.byKey.set(key, entry);
    if (row.guid === exporterGuid) roster.exporterKey = key;
  }
  return roster;
}

/** Lower rank index = higher rank; null = unknown. */
function bestRank(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.min(a, b);
}

/** D4: a rank 0–1 author, `rev` ≤ now + 600 s, strictly newer than stored. */
async function applyTemplate(
  ctx: AddonApplyContext,
  guildId: number,
  block: AddonMailworthy,
  roster: MailworthyRoster,
  nowMs: number,
): Promise<void> {
  const template = block.template;
  if (!template) return;
  const rejection = templateRejection(template, roster, nowMs);
  if (rejection) {
    logger.log(`mailworthy template rejected: guild ${guildId} — ${rejection}`);
    return;
  }
  await upsertTemplate(ctx, guildId, {
    rev: template.rev,
    authorName: template.author,
    rules: dedupeRules(template.rules),
    reportedAt: clampedDate(block.generatedAt, nowMs),
  });
}
