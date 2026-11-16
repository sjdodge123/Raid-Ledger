/**
 * ROK-2215: invite the owners of up to five planned characters to an event.
 * The organiser's own character and a second character of the same owner are
 * dropped silently; owners without a linked Discord id, deactivated owners
 * (left the guild — never DM'd) or already signed up are reported as skips
 * (never a 4xx for a skip).
 */
import { ForbiddenException } from '@nestjs/common';
import type { Logger } from '@nestjs/common';
import type { EventEmitter2 } from '@nestjs/event-emitter';
import { eq, inArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type {
  EventResponseDto,
  InviteCharactersResultDto,
} from '@raid-ledger/contract';
import * as schema from '../drizzle/schema';
import type { NotificationService } from '../notifications/notification.service';
import { isLinkedDiscordId } from '../guilds/community/discord-guild-member.helpers';
import {
  emitMemberInvite,
  getInviterUsername,
  isSignedUp,
} from './event-invite.helpers';

/** One requested character joined to its owner. */
export interface CharacterOwnerRow {
  characterId: string;
  characterName: string;
  userId: number;
  username: string;
  discordId: string | null;
  deactivatedAt: Date | null;
}

/** An owner who will be invited (their Discord id is a real link). */
export type CharacterInviteTarget = CharacterOwnerRow & { discordId: string };

type SkippedEntry = InviteCharactersResultDto['skipped'][number];
type InvitedEntry = InviteCharactersResultDto['invited'][number];

/** Who to invite and who was skipped before any signup check. */
export interface CharacterInvitePlan {
  targets: CharacterInviteTarget[];
  skipped: SkippedEntry[];
}

/** Dependencies of the invite flow (a subset of EventsService's deps). */
export interface CharacterInviteDeps {
  db: PostgresJsDatabase<typeof schema>;
  notificationService: NotificationService;
  eventEmitter: EventEmitter2;
  logger: Logger;
}

/** Loads each requested character with its owner (characters ⨝ users). */
export async function loadCharacterOwners(
  db: PostgresJsDatabase<typeof schema>,
  ids: string[],
): Promise<CharacterOwnerRow[]> {
  if (ids.length === 0) return [];
  return db
    .select({
      characterId: schema.characters.id,
      characterName: schema.characters.name,
      userId: schema.users.id,
      username: schema.users.username,
      discordId: schema.users.discordId,
      deactivatedAt: schema.users.deactivatedAt,
    })
    .from(schema.characters)
    .innerJoin(schema.users, eq(schema.users.id, schema.characters.userId))
    .where(inArray(schema.characters.id, ids));
}

/** Classifies one known character: a target, or a deactivated / no_discord skip. */
function classifyRow(
  row: CharacterOwnerRow,
): CharacterInviteTarget | SkippedEntry {
  const { characterId, characterName, discordId } = row;
  if (row.deactivatedAt !== null) {
    return { characterId, characterName, reason: 'deactivated' };
  }
  if (discordId !== null && isLinkedDiscordId(discordId)) {
    return { ...row, discordId };
  }
  return { characterId, characterName, reason: 'no_discord' };
}

/**
 * Pure: decides targets and skips in request order. First character per
 * owner wins; the inviter's own character is dropped with no entry.
 */
export function planCharacterInvites(
  rows: CharacterOwnerRow[],
  ids: string[],
  inviterId: number,
): CharacterInvitePlan {
  const byId = new Map(rows.map((r) => [r.characterId, r]));
  const seenOwners = new Set<number>();
  const plan: CharacterInvitePlan = { targets: [], skipped: [] };
  for (const id of new Set(ids)) {
    const row = byId.get(id);
    if (!row) {
      plan.skipped.push({
        characterId: id,
        characterName: null,
        reason: 'not_found',
      });
      continue;
    }
    if (row.userId === inviterId || seenOwners.has(row.userId)) continue;
    seenOwners.add(row.userId);
    const entry = classifyRow(row);
    if ('reason' in entry) plan.skipped.push(entry);
    else plan.targets.push(entry);
  }
  return plan;
}

/** Throws 403 unless the caller created the event or is staff. */
export function assertCanInviteCharacters(
  event: { creator: { id: number } },
  callerId: number,
  isAdmin: boolean,
): void {
  if (event.creator.id !== callerId && !isAdmin) {
    throw new ForbiddenException(
      'Only the event creator or an operator/admin can invite characters',
    );
  }
}

/** Invites one target unless already signed up (pre-check, never a throw). */
async function inviteTarget(
  deps: CharacterInviteDeps,
  event: EventResponseDto,
  eventId: number,
  inviterName: string,
  target: CharacterInviteTarget,
): Promise<InvitedEntry | SkippedEntry> {
  const { characterId, characterName, userId, username } = target;
  if (await isSignedUp(deps.db, eventId, userId)) {
    return { characterId, characterName, reason: 'already_signed_up' };
  }
  await emitMemberInvite(
    deps.notificationService,
    deps.eventEmitter,
    event,
    eventId,
    { id: userId, username },
    inviterName,
    target.discordId,
  );
  return { characterId, characterName, username };
}

/** Plans, then invites each remaining owner; skips keep request order. */
export async function inviteCharactersToEvent(
  deps: CharacterInviteDeps,
  event: EventResponseDto,
  eventId: number,
  inviterId: number,
  ids: string[],
): Promise<InviteCharactersResultDto> {
  const rows = await loadCharacterOwners(deps.db, ids);
  const plan = planCharacterInvites(rows, ids, inviterId);
  const result: InviteCharactersResultDto = {
    invited: [],
    skipped: [...plan.skipped],
  };
  if (plan.targets.length === 0) return result;
  const inviterName = await getInviterUsername(deps.db, inviterId);
  for (const target of plan.targets) {
    const entry = await inviteTarget(deps, event, eventId, inviterName, target);
    if ('reason' in entry) result.skipped.push(entry);
    else result.invited.push(entry);
  }
  result.skipped.sort(
    (a, b) => ids.indexOf(a.characterId) - ids.indexOf(b.characterId),
  );
  deps.logger.log(
    `User ${inviterId} invited ${result.invited.length} character owner(s) to event ${eventId}`,
  );
  return result;
}

/** Service entry: loads the event, checks creator/staff, then invites. */
export async function inviteCharactersAsCaller(
  deps: CharacterInviteDeps & {
    findOne: (id: number) => Promise<EventResponseDto>;
  },
  eventId: number,
  caller: { id: number; isAdmin: boolean },
  ids: string[],
): Promise<InviteCharactersResultDto> {
  const event = await deps.findOne(eventId);
  assertCanInviteCharacters(event, caller.id, caller.isAdmin);
  return inviteCharactersToEvent(deps, event, eventId, caller.id, ids);
}
