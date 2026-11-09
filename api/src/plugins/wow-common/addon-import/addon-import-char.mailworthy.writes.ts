import { and, eq, lt, sql } from 'drizzle-orm';
import type {
  AddonMailworthyRule,
  GuildMailworthyStoredDays,
} from '@raid-ledger/contract';
import {
  guildMailworthyGivers,
  guildMailworthyPeers,
  guildMailworthyTemplates,
} from '../../../drizzle/schema';
import type { GuildMailworthyGiverSource } from '../../../drizzle/schema/guild-mailworthy';
import type { AddonApplyContext } from './addon-import-apply.types';
import {
  sortByNameKey,
  type MailworthyPeerRow,
} from './addon-import-char.mailworthy.helpers';

/**
 * ROK-2148 D.2 — the Mailworthy writes. Every one is a single upsert whose
 * merge rule lives in `setWhere`, so two concurrent imports converge and
 * nothing catches-and-retries inside the import transaction.
 */

export interface MailworthyTemplateWrite {
  rev: number;
  authorName: string;
  rules: AddonMailworthyRule[];
  reportedAt: Date;
}

/** Whole-template replace, only by a strictly higher `rev` (D4). */
export async function upsertTemplate(
  ctx: AddonApplyContext,
  guildId: number,
  t: MailworthyTemplateWrite,
): Promise<boolean> {
  const values = { ...t, reportedByUserId: ctx.userId };
  const rows = await ctx.tx
    .insert(guildMailworthyTemplates)
    .values({ guildId, ...values })
    .onConflictDoUpdate({
      target: guildMailworthyTemplates.guildId,
      set: { ...values, updatedAt: sql`now()` },
      setWhere: sql`${guildMailworthyTemplates.rev} < excluded.rev`,
    })
    .returning({ guildId: guildMailworthyTemplates.guildId });
  return rows.length > 0;
}

/** Peers keep the GREATEST `last_seen_at`; the name follows the report. */
export async function upsertPeers(
  ctx: AddonApplyContext,
  guildId: number,
  peers: readonly MailworthyPeerRow[],
): Promise<void> {
  if (peers.length === 0) return;
  const t = guildMailworthyPeers;
  await ctx.tx
    .insert(t)
    .values(sortByNameKey(peers).map((p) => ({ guildId, ...p })))
    .onConflictDoUpdate({
      target: [t.guildId, t.nameKey],
      set: {
        name: sql`excluded.name`,
        lastSeenAt: sql`GREATEST(${t.lastSeenAt}, excluded.last_seen_at)`,
        updatedAt: sql`now()`,
      },
    });
}

/** Bound the table: drop the guild's peers unseen since `cutoff`. */
export async function prunePeers(
  ctx: AddonApplyContext,
  guildId: number,
  cutoff: Date,
): Promise<void> {
  await ctx.tx
    .delete(guildMailworthyPeers)
    .where(
      and(
        eq(guildMailworthyPeers.guildId, guildId),
        lt(guildMailworthyPeers.lastSeenAt, cutoff),
      ),
    );
}

export interface MailworthyGiverRow {
  nameKey: string;
  characterName: string;
  itemsAllTime: number;
  countingSince: Date;
  days: GuildMailworthyStoredDays;
  asOf: Date;
  generatedAt: Date;
  source: GuildMailworthyGiverSource;
}

/**
 * Amended D5 precedence, as ONE predicate: `self` always replaces
 * `relayed`; `relayed` never replaces `self`; same source moves only on a
 * not-older (`as_of`, `generated_at`). TS twin (the preview's rule):
 * `giverPrecedence` in `…mailworthy.helpers.ts` — moves exactly when it is
 * >= 0; change both together.
 */
const giverMoves = sql`(excluded.source = 'self' AND ${guildMailworthyGivers.source} = 'relayed')
  OR (excluded.source = ${guildMailworthyGivers.source}
    AND (${guildMailworthyGivers.asOf}, ${guildMailworthyGivers.generatedAt})
      <= (excluded.as_of, excluded.generated_at))`;

const ex = (col: string) => sql.raw(`excluded.${col}`);

/** What a moving giver row takes from the export. */
const giverSet = {
  characterName: ex('character_name'),
  itemsAllTime: ex('items_all_time'),
  countingSince: ex('counting_since'),
  days: ex('days'),
  asOf: ex('as_of'),
  generatedAt: ex('generated_at'),
  source: ex('source'),
  reportedByUserId: ex('reported_by_user_id'),
  updatedAt: sql`now()`,
};

/**
 * Upsert the export's accepted givers (already deduped by name key).
 * Returns how many rows were written — a row `giverMoves` refused is not.
 */
export async function upsertGivers(
  ctx: AddonApplyContext,
  guildId: number,
  givers: readonly MailworthyGiverRow[],
): Promise<number> {
  if (givers.length === 0) return 0;
  const t = guildMailworthyGivers;
  const rows = await ctx.tx
    .insert(t)
    .values(
      sortByNameKey(givers).map((g) => ({
        guildId,
        ...g,
        reportedByUserId: ctx.userId,
      })),
    )
    .onConflictDoUpdate({
      target: [t.guildId, t.nameKey],
      set: giverSet,
      setWhere: giverMoves,
    })
    .returning({ nameKey: t.nameKey });
  return rows.length;
}
