/**
 * ROK-2352 §3.8 "Find a time" exit — an LFG group converted to a poll
 * (`lfg_intents.converted_to_poll_id = <match id>`) keeps each member's
 * hand character + roles when the poll locks in.
 *
 * Only character/roles are carried (§7 Q1): the instance and roster are NOT
 * set on the poll-locked event in v1 — the poll schema has no
 * `contentInstances`/`slotConfig`. The read is an enrichment: no adapter
 * (plugin off, non-grouped game), no converted hands or a failed read all
 * give an empty map, never a dropped voter or a failed lock-in.
 */
import type { Logger } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import type { CreateSignupDto } from '@raid-ledger/contract';
import * as schema from '../drizzle/schema';
import {
  resolveLfgGrouping,
  type LfgGroupingRegistry,
} from './lfg-grouping.helpers';
import type { LfgDb } from './lfg-query.helpers';

/** What the poll carryover read needs. */
export interface LfgPollCarryoverDeps {
  db: LfgDb;
  /** Absent → no LFG carryover (slim apps / callers without the registry). */
  lfgGrouping?: LfgGroupingRegistry | undefined;
  logger: Pick<Logger, 'warn'>;
}

/** A hand that converted into the poll, with its game's slug. */
interface ConvertedHand {
  intentId: number;
  gameSlug: string;
}

async function selectConvertedHands(
  db: LfgDb,
  matchId: number,
  userIds: number[],
): Promise<ConvertedHand[]> {
  return db
    .select({ intentId: schema.lfgIntents.id, gameSlug: schema.games.slug })
    .from(schema.lfgIntents)
    .innerJoin(schema.games, eq(schema.games.id, schema.lfgIntents.gameId))
    .where(
      and(
        eq(schema.lfgIntents.convertedToPollId, matchId),
        inArray(schema.lfgIntents.userId, userIds),
      ),
    );
}

/** Group the converted hands by game slug (a poll converts one game). */
function bySlug(hands: ConvertedHand[]): Map<string, number[]> {
  const out = new Map<string, number[]>();
  for (const h of hands) {
    out.set(h.gameSlug, [...(out.get(h.gameSlug) ?? []), h.intentId]);
  }
  return out;
}

async function readPollCarryover(
  deps: LfgPollCarryoverDeps & { lfgGrouping: LfgGroupingRegistry },
  matchId: number,
  userIds: number[],
): Promise<Map<number, CreateSignupDto>> {
  const carryover = new Map<number, CreateSignupDto>();
  const hands = await selectConvertedHands(deps.db, matchId, userIds);
  for (const [slug, intentIds] of bySlug(hands)) {
    const adapter = resolveLfgGrouping(deps.lfgGrouping, slug);
    if (adapter === null) continue;
    const carried = await adapter.buildCarryover({ intentIds });
    for (const [userId, dto] of carried) carryover.set(userId, dto);
  }
  return carryover;
}

/**
 * userId → {characterId?, preferredRoles?} from the LFG hands that converted
 * into this poll. Empty when nothing applies or the read fails (logged).
 *
 * @param deps - Db, the plugin registry (fold rule) and a logger.
 * @param matchId - The poll (`community_lineup_matches.id`).
 * @param userIds - The voters being signed up.
 */
export async function loadLfgPollCarryover(
  deps: LfgPollCarryoverDeps,
  matchId: number,
  userIds: readonly number[],
): Promise<Map<number, CreateSignupDto>> {
  const { lfgGrouping } = deps;
  if (userIds.length === 0 || lfgGrouping === undefined) return new Map();
  try {
    return await readPollCarryover(
      { ...deps, lfgGrouping },
      matchId,
      [...userIds],
    );
  } catch (err: unknown) {
    deps.logger.warn(
      `LFG poll carryover read failed for match ${matchId}; signing up without it: ${String(err)}`,
    );
    return new Map();
  }
}

/**
 * Merge the LFG map under the follow-up (ROK-2320) map: on a clash the
 * follow-up source-event signup wins (AC7).
 */
export function mergeCarryover(
  lfg: ReadonlyMap<number, CreateSignupDto>,
  followup: ReadonlyMap<number, CreateSignupDto>,
): Map<number, CreateSignupDto> {
  return new Map([...lfg, ...followup]);
}
