import { Logger } from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type {
  AddonMailworthy,
  AddonMailworthyImportOutcome,
} from '@raid-ledger/contract';
import { characters, guildMembers, guilds } from '../../../drizzle/schema';
import { mailworthyNameKey } from '../../../drizzle/schema/guild-mailworthy.name-key';
import {
  characterLink,
  inLatestSnapshot,
} from '../guilds/guild-membership.helpers';
import {
  guildNameKey,
  type AddonApplyContext,
  type AddonSectionOutcome,
} from './addon-import-apply.types';
import {
  clampedDate,
  dedupeRules,
  templateRejection,
  type MailworthyRoster,
} from './addon-import-char.mailworthy.helpers';
import {
  applyMailworthyLists,
  type MailworthyListsResult,
} from './addon-import-char.mailworthy.lists';
import { upsertTemplate } from './addon-import-char.mailworthy.writes';
import { exportClock } from './addon-import.clock';
import type { DecodedAddonCharExport } from './addon-import.decoder';

/**
 * ROK-2148 D.2 — apply the `char` export's Mailworthy block (lifted to
 * `payload.mailworthy` by the decoder) to its guild's template / peers /
 * givers. Runs after every section of the paste (`runPaste`) in the same
 * transaction whatever the char status (a stale char snapshot can still carry newer givers); never throws
 * for block content — a skip or a rejected row is logged and reported on the
 * char summary's `mailworthy` (Q8; absent with no block). Dry runs never reach it.
 */

type TemplateOutcome = 'stored' | 'unchanged' | 'rejected' | 'none';

const logger = new Logger('AddonImportMailworthy');

/**
 * The char section's outcome with its Mailworthy block applied. `runPaste`
 * calls it once EVERY section of the paste has run (Codex P2): an "Export
 * all" paste's guild section must refresh the roster D5 checks first.
 */
export async function withCharMailworthy<S extends object>(
  ctx: AddonApplyContext,
  payload: DecodedAddonCharExport,
  outcome: AddonSectionOutcome<S>,
): Promise<AddonSectionOutcome<S>> {
  const mailworthy = await applyCharMailworthy(ctx, payload);
  if (!mailworthy) return outcome;
  return { ...outcome, summary: { ...outcome.summary, mailworthy } };
}

const skipped = (
  reason: Extract<
    AddonMailworthyImportOutcome,
    { status: 'skipped' }
  >['reason'],
): AddonMailworthyImportOutcome => ({ status: 'skipped', reason });

export async function applyCharMailworthy(
  ctx: AddonApplyContext,
  payload: DecodedAddonCharExport,
): Promise<AddonMailworthyImportOutcome | undefined> {
  const block = payload.mailworthy;
  if (!block) return undefined;
  const guildName = payload.who.guildName;
  const guildId = guildName ? await findGuildId(ctx, guildName) : undefined;
  if (guildId === undefined) {
    logger.log('mailworthy skipped: no guild');
    return skipped('guild_unresolved');
  }
  const roster = await loadRoster(ctx, guildId, payload.who.guid);
  if (roster.exporterKey === undefined) {
    logger.log(
      `mailworthy skipped: guild ${guildId} exporter not in latest roster`,
    );
    return skipped('not_on_roster');
  }
  const nowMs = exportClock.nowMs();
  const template = await applyTemplate(ctx, guildId, block, roster, nowMs);
  const input = { payload, block, roster, nowMs };
  const lists = await applyMailworthyLists(ctx, guildId, input);
  return mailworthyOutcome(lists, template);
}

/** Every giver off-roster → skipped; otherwise applied with its counts. */
function mailworthyOutcome(
  { counts, giversAccepted }: MailworthyListsResult,
  template: TemplateOutcome,
): AddonMailworthyImportOutcome {
  if (giversAccepted === 0 && counts.giversRejected > 0) {
    return skipped('givers_rejected');
  }
  return { status: 'applied', ...counts, template };
}

/** The realm-less guild the guild section writes (`applyGuild`'s target). */
export async function findGuildId(
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
export async function loadRoster(
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
): Promise<TemplateOutcome> {
  const template = block.template;
  if (!template) return 'none';
  const rejection = templateRejection(template, roster, nowMs);
  if (rejection) {
    logger.log(`mailworthy template rejected: guild ${guildId} — ${rejection}`);
    return 'rejected';
  }
  const stored = await upsertTemplate(ctx, guildId, {
    rev: template.rev,
    authorName: template.author,
    rules: dedupeRules(template.rules),
    reportedAt: clampedDate(block.generatedAt, nowMs),
  });
  return stored ? 'stored' : 'unchanged';
}
