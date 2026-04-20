/**
 * Thin helper around invitee add/remove that also loads the lineup,
 * validates existence, and returns the refreshed detail response. Kept
 * separate from the low-level helpers so lineups.service.ts stays under
 * the 300-line ESLint ceiling (ROK-1065).
 */
import { NotFoundException } from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { LineupDetailResponseDto } from '@raid-ledger/contract';
import * as schema from '../drizzle/schema';
import { findLineupById } from './lineups-query.helpers';
import {
  addInvitees,
  removeInvitee as removeInviteeLow,
} from './lineups-invitees.helpers';
import { buildDetailResponse } from './lineups-response.helpers';

type Db = PostgresJsDatabase<typeof schema>;

/** Add one or more invitees; return refreshed lineup detail. */
export async function runAddInvitees(
  db: Db,
  resolveChannelName: (channelId: string) => string | null,
  lineupId: number,
  userIds: number[],
  callerId: number,
): Promise<LineupDetailResponseDto> {
  const [lineup] = await findLineupById(db, lineupId);
  if (!lineup) throw new NotFoundException('Lineup not found');
  await addInvitees(db, lineupId, userIds);
  return buildDetailResponse(db, lineupId, callerId, resolveChannelName);
}

/** Remove a single invitee; return refreshed lineup detail. */
export async function runRemoveInvitee(
  db: Db,
  resolveChannelName: (channelId: string) => string | null,
  lineupId: number,
  userId: number,
  callerId: number,
): Promise<LineupDetailResponseDto> {
  const [lineup] = await findLineupById(db, lineupId);
  if (!lineup) throw new NotFoundException('Lineup not found');
  await removeInviteeLow(db, lineupId, userId);
  return buildDetailResponse(db, lineupId, callerId, resolveChannelName);
}
