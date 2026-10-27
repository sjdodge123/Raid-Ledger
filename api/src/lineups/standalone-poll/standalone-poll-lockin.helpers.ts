/**
 * Lock-in fan-out for `StandalonePollService.complete()` (ROK-1031 / ROK-2024),
 * extracted to keep the service under the 300-line file cap.
 *
 * Signs up the winning slot's yes-voters, hearts the game, DMs the voters and
 * then — for a fresh (non-reschedule) poll only — announces EVENT CREATED, so
 * the announcement's roster and "N of M" line see the signups.
 */
import type { Logger } from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import type { SettingsService } from '../../settings/settings.service';
import type { SignupsService } from '../../events/signups.service';
import type { LineupNotificationService } from '../lineup-notification.service';
import { fireEventCreated } from '../lineups-notify-hooks.helpers';
import {
  findScheduleSlots,
  findScheduleVotes,
} from '../scheduling/scheduling-query.helpers';
import { autoSignupSlotVoters } from '../scheduling/scheduling-auto-signup.helpers';
import type { StandalonePollNotificationService } from './standalone-poll-notification.service';
import {
  splitYesVotersBySlot,
  notifyPollVoters,
  heartPollGameForVoters,
} from './standalone-poll-voter.helpers';
import { matchHubPayload } from './poll-hub-payload.helpers';

/** Everything the lock-in fan-out reaches. */
export interface LockInFanoutDeps {
  db: PostgresJsDatabase<typeof schema>;
  signupsService: SignupsService;
  settingsService: SettingsService;
  notifications: StandalonePollNotificationService;
  lineupNotifications: LineupNotificationService;
  logger: Logger;
}

/** What was locked in: the match, its event and the winning slot. */
export interface LockIn {
  matchId: number;
  eventId: number;
  startTime: string;
  creatorId?: number | undefined;
  /** False for a reschedule poll — its event was announced long ago. */
  announce: boolean;
}

/**
 * Fire-and-forget: sign up + notify the slot voters, then announce once.
 * A failed signup is logged; the announcement still follows so the event is
 * not left unannounced.
 */
export function fireLockInFanout(deps: LockInFanoutDeps, lockIn: LockIn): void {
  const { matchId, eventId, startTime } = lockIn;
  signUpSlotVoters(deps, lockIn)
    .catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      deps.logger.warn(`Auto-signup failed for match ${matchId}: ${msg}`);
    })
    .then(() => {
      if (!lockIn.announce) return;
      fireEventCreated(
        deps.lineupNotifications,
        deps.logger,
        deps.db,
        matchId,
        new Date(startTime),
        eventId,
      );
    })
    .catch(() => {});
}

/** Auto-signup + auto-heart + DMs for the winning slot's voters (ROK-1031). */
async function signUpSlotVoters(
  deps: LockInFanoutDeps,
  lockIn: LockIn,
): Promise<void> {
  const { db } = deps;
  const { matchId, eventId, startTime } = lockIn;
  const slots = await findScheduleSlots(db, matchId);
  const allVoters = await findScheduleVotes(
    db,
    slots.map((s) => s.id),
  );
  // ROK-1617: yes-votes only on both sides of the split — see
  // `splitYesVotersBySlot` for what an anti-voter deliberately does NOT get.
  const { selectedVoters, otherVoters } = splitYesVotersBySlot(
    slots,
    allVoters,
    startTime,
  );
  const { benchedUserIds } = await autoSignupSlotVoters({
    eventId,
    creatorId: lockIn.creatorId ?? -1,
    voters: selectedVoters,
    signupsService: deps.signupsService,
  });
  // Hearts the game for the yes-voters (ROK-1617 item E) and hands back the
  // name the DMs below announce.
  const gameName = await heartPollGameForVoters(db, matchId, allVoters);
  await notifyPollVoters(
    {
      db,
      settingsService: deps.settingsService,
      notifications: deps.notifications,
    },
    selectedVoters,
    otherVoters,
    benchedUserIds,
    startTime,
    eventId,
    gameName ?? 'Game Night',
    await matchHubPayload(db, matchId),
  );
}
