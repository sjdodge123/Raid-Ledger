/**
 * Lock-in fan-out for `StandalonePollService.complete()` (ROK-1031 / ROK-2024),
 * extracted to keep the service under the 300-line file cap.
 *
 * Signs up the winning slot's yes-voters (awaited — ROK-2031), then hearts
 * the game, DMs the voters and — for a fresh (non-reschedule) poll only —
 * announces EVENT CREATED, so the announcement's roster sees the signups.
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
import { revalidateBenchPick } from './standalone-poll-bench-pick.helpers';

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
  /** ROK-2025: the organizer's validated bench pick; absent = latest voters. */
  benchUserIds?: ReadonlySet<number> | undefined;
}

/** What the awaited signup step hands the fire-and-forget tail. */
type SignedUp = Awaited<ReturnType<typeof pickSlotVoters>> & {
  benchedUserIds: number[];
};

const errMsg = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

/**
 * ROK-2031: awaited by `complete()`, so the response follows the signups.
 * Signs the slot voters up, then fires heart → DMs → announce without
 * waiting. Never rejects: a failed signup is logged and the announcement
 * still follows (with nobody skipped) so the event is not left unannounced.
 */
export async function runLockInFanout(
  deps: LockInFanoutDeps,
  lockIn: LockIn,
): Promise<void> {
  const signed = await signUpStep(deps, lockIn).catch((err: unknown) => {
    deps.logger.warn(
      `Auto-signup failed for match ${lockIn.matchId}: ${errMsg(err)}`,
    );
    return null;
  });
  fireNotifyThenAnnounce(deps, lockIn, signed);
}

/** The awaited half: pick the slot voters and sign them up (ROK-1031). */
async function signUpStep(
  deps: LockInFanoutDeps,
  lockIn: LockIn,
): Promise<SignedUp> {
  const voters = await pickSlotVoters(
    deps.db,
    lockIn.matchId,
    lockIn.startTime,
  );
  const benchedUserIds = await signUpWithPick(
    deps,
    lockIn,
    voters.selectedVoters,
  );
  return { ...voters, benchedUserIds };
}

/**
 * Fire-and-forget: heart + DM the voters, then announce once. The EVENT
 * CREATED DM skips the voters the poll DM'd (ROK-2024) — after a failed
 * signup or a failed heart/DM nobody is skipped.
 */
function fireNotifyThenAnnounce(
  deps: LockInFanoutDeps,
  lockIn: LockIn,
  signed: SignedUp | null,
): void {
  const notified = signed
    ? notifySlotVoters(deps, lockIn, signed).catch((err: unknown) => {
        deps.logger.warn(
          `Lock-in DMs failed for match ${lockIn.matchId}: ${errMsg(err)}`,
        );
        return new Set<number>();
      })
    : Promise.resolve(new Set<number>());
  notified.then((skip) => announce(deps, lockIn, skip)).catch(() => {});
}

/** EVENT CREATED, unless this is a reschedule (ROK-2024). */
function announce(
  deps: LockInFanoutDeps,
  lockIn: LockIn,
  pollDmUserIds: ReadonlySet<number>,
): void {
  if (!lockIn.announce) return;
  fireEventCreated(
    deps.lineupNotifications,
    deps.logger,
    deps.db,
    lockIn.matchId,
    new Date(lockIn.startTime),
    lockIn.eventId,
    pollDmUserIds,
  );
}

/** The match's yes-voters, split into the winning slot's and the rest. */
async function pickSlotVoters(
  db: LockInFanoutDeps['db'],
  matchId: number,
  startTime: string,
) {
  const slots = await findScheduleSlots(db, matchId);
  const allVoters = await findScheduleVotes(
    db,
    slots.map((s) => s.id),
  );
  // ROK-1617: yes-votes only on both sides of the split — see
  // `splitYesVotersBySlot` for what an anti-voter deliberately does NOT get.
  return {
    allVoters,
    ...splitYesVotersBySlot(slots, allVoters, startTime),
  };
}

/**
 * ROK-2025: the organizer's pick, re-checked against the SAME voters the
 * signup uses; a pick the votes outgrew is dropped (logged) for the default.
 */
async function benchPickForVoters(
  deps: LockInFanoutDeps,
  lockIn: LockIn,
  voters: readonly { userId: number }[],
): Promise<ReadonlySet<number> | undefined> {
  if (!lockIn.benchUserIds) return undefined;
  const ids = voters.map((v) => v.userId);
  const pick = await revalidateBenchPick(
    deps.db,
    lockIn.eventId,
    ids,
    lockIn.benchUserIds,
  );
  if (!pick) {
    deps.logger.warn(
      `Bench pick for match ${lockIn.matchId} no longer fits the slot voters; benching the latest yes-voters`,
    );
  }
  return pick;
}

/** Sign the slot voters up, benching the re-checked pick; the benched ids. */
async function signUpWithPick(
  deps: LockInFanoutDeps,
  lockIn: LockIn,
  voters: { userId: number }[],
): Promise<number[]> {
  const benchUserIds = await benchPickForVoters(deps, lockIn, voters);
  const { benchedUserIds } = await autoSignupSlotVoters({
    eventId: lockIn.eventId,
    creatorId: lockIn.creatorId ?? -1,
    voters,
    signupsService: deps.signupsService,
    ...(benchUserIds ? { benchUserIds } : {}),
  });
  return benchedUserIds;
}

/**
 * Auto-heart + DMs for the winning slot's voters (ROK-1031), after signup.
 * Returns the users sent "Auto-signed up" / "On the bench" (ROK-2024).
 */
async function notifySlotVoters(
  deps: LockInFanoutDeps,
  lockIn: LockIn,
  signed: SignedUp,
): Promise<ReadonlySet<number>> {
  const { matchId, eventId, startTime } = lockIn;
  // Hearts the game for the yes-voters (ROK-1617 item E) and hands back the
  // name the DMs below announce.
  const gameName = await heartPollGameForVoters(
    deps.db,
    matchId,
    signed.allVoters,
  );
  await notifyPollVoters(
    deps,
    signed.selectedVoters,
    signed.otherVoters,
    signed.benchedUserIds,
    startTime,
    eventId,
    gameName ?? 'Game Night',
    await matchHubPayload(deps.db, matchId),
  );
  return new Set(signed.selectedVoters.map((v) => v.userId));
}
