/**
 * ROK-1896 — the hub a poll DM names and links to.
 *
 * A poll DM carries `hubId` + `hubName` only while the poll's tied hub
 * (`community_lineups.guild_id`) is VISIBLE (`visibleCommunityHubWhere`). A
 * hidden / archived / untagged hub yields `{}` — the keys are ABSENT, never
 * `undefined`, so an untagged poll's payload stays byte-identical to before.
 * Lookups are best-effort: a failure logs and yields `{}`, so a DM never
 * fails over its hub.
 */
import { Logger } from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import {
  findMatchPollHub,
  findVisiblePollHub,
  type PollHub,
} from './standalone-poll-hub.helpers';
import { loadLineupHubId } from '../scheduling/scheduling-poll-embed-data.helpers';

type Db = PostgresJsDatabase<typeof schema>;

/** Hub keys spread into a poll DM payload (both present or both absent). */
export interface PollHubPayload {
  hubId?: number;
  hubName?: string;
}

/** Notification payload for standalone scheduling polls. */
export interface PollNotifPayload extends PollHubPayload {
  subtype: string;
  lineupId: number;
  matchId: number;
  gameName: string;
  creatorName: string;
  gameCoverUrl?: string;
}

const logger = new Logger('PollHubPayload');

function toPayload(hub: PollHub | null): PollHubPayload {
  return hub ? { hubId: hub.id, hubName: hub.name } : {};
}

function warnFailure(what: string, err: unknown): PollHubPayload {
  const reason = err instanceof Error ? err.message : String(err);
  logger.warn(`Poll hub lookup failed for ${what}: ${reason}`);
  return {};
}

/** Hub keys for a poll's lineup (its visible tied hub). Never throws. */
export async function lineupHubPayload(
  db: Db,
  lineupId: number,
): Promise<PollHubPayload> {
  try {
    const guildId = await loadLineupHubId(db, lineupId);
    if (guildId === null) return {};
    return toPayload(await findVisiblePollHub(db, guildId));
  } catch (err) {
    return warnFailure(`lineup ${lineupId}`, err);
  }
}

/** Hub keys for the poll behind a scheduling match. Never throws. */
export async function matchHubPayload(
  db: Db,
  matchId: number,
): Promise<PollHubPayload> {
  try {
    return toPayload(await findMatchPollHub(db, matchId));
  } catch (err) {
    return warnFailure(`match ${matchId}`, err);
  }
}

/** Inputs of the generic poll DM payload. */
export interface PollBaseInput {
  lineupId: number;
  matchId: number;
  gameName: string;
  creatorName: string;
  gameCoverUrl?: string | null | undefined;
}

/**
 * The base poll DM payload (moved from the notification service, ROK-1896)
 * with the lineup's visible hub resolved once per fan-out.
 */
export async function pollBasePayload(
  db: Db,
  input: PollBaseInput,
): Promise<PollNotifPayload> {
  const { lineupId, matchId, gameName, creatorName, gameCoverUrl } = input;
  return {
    subtype: 'standalone_scheduling_poll',
    lineupId,
    matchId,
    gameName,
    creatorName,
    ...(gameCoverUrl ? { gameCoverUrl } : {}),
    ...(await lineupHubPayload(db, lineupId)),
  };
}
