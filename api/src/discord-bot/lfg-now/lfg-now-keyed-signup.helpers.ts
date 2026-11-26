/**
 * ROK-2352 P1-2 — a keyed group's session (a WoW instance) signs its members
 * up the way a Lock-in does: through `SignupsService` with the adapter's
 * carryover (character + preferredRoles, ROK-2320), so they land in the
 * instance's role slots, not the generic `player` slots of the Any / fold
 * session (`autoSignupParticipant`).
 *
 * The spawn transaction DEFERS them — `SignupsService` runs on its own
 * connection and cannot see the uncommitted event — and the caller signs them
 * up right after COMMIT. A member whose role-aware signup fails falls back to
 * the generic Discord roster row, so nobody converted is left off the event.
 */
import type { CreateSignupDto } from '@raid-ledger/contract';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../../drizzle/schema';
import type { SignupsService } from '../../events/signups.service';
import { autoSignupSlotVoters } from '../../lineups/scheduling/scheduling-auto-signup.helpers';
import {
  buildGroupLockInPatch,
  type LfgLockInGroup,
} from '../../lfg/lfg-lock-in-group.helpers';
import type { LfgGroupScope } from '../../lfg/lfg-group-scope.helpers';
import type { LfgSignupCarryover } from '../../plugins/plugin-host/lfg-grouping.adapter';
import { autoSignupParticipant } from '../services/ad-hoc-event.signup-helpers';
import type { LfgNowHand, LfgNowKeyedSignup } from './lfg-now-spawn.types';

type Db = PostgresJsDatabase<typeof schema>;

/** True for a real group key (a WoW instance); false for `''` and the fold. */
export function isKeyedScope(scope: LfgGroupScope): boolean {
  return scope !== null && scope !== '';
}

/** `{ groupKey }` for a keyed scope, `{}` for `''` / the fold (payloads). */
export function groupKeyField(scope: LfgGroupScope): { groupKey?: string } {
  return scope ? { groupKey: scope } : {};
}

/** In-tx: the adapter's carryover for the group's live members. */
export async function keyedCarryover(
  tx: Db,
  gameId: number,
  group: LfgLockInGroup,
): Promise<LfgSignupCarryover> {
  const patch = await buildGroupLockInPatch(tx, gameId, group);
  return patch?.carryover ?? new Map<number, never>();
}

/** The result spread that hands keyed members to the post-COMMIT signup. */
export function deferKeyedSignup(
  hands: LfgNowHand[],
  carryover: LfgSignupCarryover | undefined,
): { keyedSignup?: LfgNowKeyedSignup } {
  if (hands.length === 0) return {};
  return {
    keyedSignup: { hands, carryover: carryover ?? new Map<number, never>() },
  };
}

/** Every MMO role: a member the adapter names no role for signs up flex. */
const FLEX_ROLES: NonNullable<CreateSignupDto['preferredRoles']> = [
  'tank',
  'healer',
  'dps',
];

/**
 * ROK-2352 P1-4 (ruled: a late keyed `now` hand attaches like the Any group's):
 * a keyed session is an MMO event, where a signup with no roles lands in the
 * unassigned pool with NO roster slot. So a member the carryover gives no
 * roles signs up flex — auto-allocation slots them wherever the instance has
 * room (bench when full) and can still rebalance them for a real tank later.
 * Their carried character, if any, is kept.
 */
export function withFlexRoles(
  hands: LfgNowHand[],
  carryover: LfgSignupCarryover,
): Map<number, CreateSignupDto> {
  const out = new Map<number, CreateSignupDto>();
  for (const { userId } of hands) {
    const carried = carryover.get(userId);
    out.set(
      userId,
      carried?.preferredRoles?.length
        ? carried
        : { ...carried, preferredRoles: [...FLEX_ROLES] },
    );
  }
  return out;
}

/** What the post-COMMIT signup needs. */
export interface KeyedSignupDeps {
  db: Db;
  signupsService: Pick<SignupsService, 'signup'> | null;
}

/**
 * Post-COMMIT: sign the deferred keyed members up role-aware; anyone whose
 * signup failed (or with no `SignupsService`) gets the generic roster row.
 *
 * @param deps - Outer db + signups service.
 * @param eventId - The session.
 * @param signup - `LfgNowSpawnResult.keyedSignup`; absent = nothing to do.
 */
export async function signupKeyedMembers(
  deps: KeyedSignupDeps,
  eventId: number,
  signup: LfgNowKeyedSignup | undefined,
): Promise<void> {
  if (!signup) return;
  const failed = deps.signupsService
    ? (
        await autoSignupSlotVoters({
          eventId,
          creatorId: null,
          voters: signup.hands,
          signupsService: deps.signupsService,
          carryover: withFlexRoles(signup.hands, signup.carryover),
        })
      ).failedUserIds
    : signup.hands.map((h) => h.userId);
  for (const hand of signup.hands) {
    if (!failed.includes(hand.userId) || !hand.discordId) continue;
    await autoSignupParticipant(deps.db, eventId, {
      discordUserId: hand.discordId,
      discordUsername: hand.username,
      discordAvatarHash: hand.discordAvatarHash,
      userId: hand.userId,
    });
  }
}
