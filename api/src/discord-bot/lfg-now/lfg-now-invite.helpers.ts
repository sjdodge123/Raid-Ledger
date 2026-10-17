/**
 * AC4's invites: the OTHER +1s are ASKED to join a session that just started
 * (ROK-1613).
 *
 * Deliberately NOT `LfgInviteService.invite`: that path is cold outreach and
 * refuses anyone already holding a live intent (`in_group`), which is every
 * recipient here. The restraints it enforces — the group's daily cap, the
 * no-repeat horizon — exist to stop strangers being spammed, and these people
 * asked to play this game. What is reused is the WIRE shape:
 * `lfg_player_invite`, so the existing DM embed and its Join button render it.
 *
 * Every send is isolated: one recipient's failure must not cost the others
 * their invite, and none of it may fail the start (the session already exists).
 */
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import { LFG_INVITE_NOTIFICATION_TYPE } from '../../lfg/lfg-invite.constants';
import type { LfgPlayerInvitePayload } from '../../lfg/lfg-invite.service';
import { buildLfgInviteUrl } from '../../notifications/lfg-affinity-dm.helpers';
import type { CreateNotificationInput } from '../../notifications/notification.types';

type Db = PostgresJsDatabase<typeof schema>;

/** The slice of `NotificationService` this dispatch needs. */
export interface LiveSessionInviteSink {
  create(input: CreateNotificationInput): Promise<unknown>;
}

/** Everything one dispatch needs that is not already on the db. */
export interface LiveSessionInviteArgs {
  gameId: number;
  starterUserId: number;
  /** The other live participants — `LfgNowSpawnResult.invitedUserIds`. */
  userIds: number[];
  /** Configured client URL, or null when none is set; used for the link. */
  clientUrl: string | null;
}

/**
 * Build the notification body every invitee receives.
 *
 * `urgency: 'now'` is a fact here rather than a snapshot: a session is live.
 *
 * @param game - The group's game.
 * @param starterUserId - Who pressed start.
 * @param starterName - Their display name, for the `Invited by` line.
 * @param clientUrl - Configured client URL, or null.
 * @returns The notification body, minus the recipient.
 */
export function buildLiveSessionInvite(
  game: { id: number; name: string; slug: string },
  starterUserId: number,
  starterName: string,
  clientUrl: string | null,
): Omit<CreateNotificationInput, 'userId'> {
  const url = buildLfgInviteUrl(clientUrl, game.slug);
  const payload: LfgPlayerInvitePayload = {
    gameId: game.id,
    gameSlug: game.slug,
    gameName: game.name,
    inviterUserId: starterUserId,
    inviterName: starterName,
    reasons: [],
    urgency: 'now',
    ...(url ? { url } : {}),
  };
  return {
    type: LFG_INVITE_NOTIFICATION_TYPE,
    title: `${starterName} started playing ${game.name} — join?`,
    message: url
      ? `They're playing right now: ${url}`
      : "They're playing right now — open the group on the LFG board.",
    payload: { ...payload },
  };
}

/**
 * Send the start-now invite to every other live participant.
 *
 * MUST be called AFTER the spawn transaction commits: a rollback would
 * otherwise leave a DM announcing a session that does not exist.
 *
 * @param db - Drizzle handle (the outer one, post-commit).
 * @param notifications - Notification dispatcher.
 * @param args - Group, starter, recipients and the client URL.
 * @returns How many invites were dispatched.
 */
export async function dispatchLiveSessionInvites(
  db: Db,
  notifications: LiveSessionInviteSink,
  args: LiveSessionInviteArgs,
): Promise<number> {
  if (args.userIds.length === 0) return 0;
  const game = await loadGame(db, args.gameId);
  if (!game) return 0;
  const body = buildLiveSessionInvite(
    game,
    args.starterUserId,
    await resolveStarterName(db, args.starterUserId),
    args.clientUrl,
  );
  const sent = await Promise.all(
    args.userIds.map((userId) =>
      notifications
        .create({ userId, ...body })
        .then(() => 1)
        .catch(() => 0),
    ),
  );
  return sent.reduce((total: number, one: number) => total + one, 0);
}

/** The game row the DM renders from. */
async function loadGame(
  db: Db,
  gameId: number,
): Promise<{ id: number; name: string; slug: string } | null> {
  const [game] = await db
    .select({
      id: schema.games.id,
      name: schema.games.name,
      slug: schema.games.slug,
    })
    .from(schema.games)
    .where(eq(schema.games.id, gameId))
    .limit(1);
  return game ?? null;
}

/** Display name, then username — mirrors the player-invite DM's `Invited by`. */
async function resolveStarterName(db: Db, userId: number): Promise<string> {
  const [row] = await db
    .select({
      username: schema.users.username,
      displayName: schema.users.displayName,
    })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  return row?.displayName ?? row?.username ?? 'A player';
}
