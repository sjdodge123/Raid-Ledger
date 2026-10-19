import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  ValheimCharacterOwner,
  ValheimClaimEvent,
} from '@raid-ledger/contract';
import type { ValheimProfileClaimEventRow } from '../../../../drizzle/schema';
import {
  ValheimIdentityRepository,
  type ArmoryUserRow,
} from './valheim-identity.repository';

/** Audit row → contract shape (ids + ISO time; never a SteamID). */
export function toClaimEvent(
  row: ValheimProfileClaimEventRow,
): ValheimClaimEvent {
  return {
    id: row.id,
    profileId: row.profileId,
    action: row.action,
    fromUserId: row.fromUserId,
    toUserId: row.toUserId,
    actorUserId: row.actorUserId,
    createdAt: row.createdAt.toISOString(),
  };
}

function toOwner(u: ArmoryUserRow): ValheimCharacterOwner {
  return {
    id: u.id,
    username: u.username,
    avatar: u.avatar,
    discordId: u.discordId,
  };
}

function firstEvent(rows: ValheimProfileClaimEventRow[]): ValheimClaimEvent {
  const [row] = rows;
  if (!row) throw new Error('claim audit insert returned no row');
  return toClaimEvent(row);
}

const notFound = () => new NotFoundException('character_not_found');

/**
 * ROK-1835 L3 member claim + admin assign/unassign + audit read. Every owner
 * change writes its audit row in the same transaction (D6).
 */
@Injectable()
export class ValheimArmoryClaimsService {
  constructor(private readonly repo: ValheimIdentityRepository) {}

  /** Claim an unclaimed character (no approval, no SteamID check); 409 if claimed. */
  claim(profileId: number, userId: number): Promise<ValheimClaimEvent> {
    return this.repo.transaction(async (tx) => {
      if (!(await this.repo.claimIfUnclaimed(tx, profileId, userId))) {
        if (!(await this.repo.profileExists(profileId, tx))) throw notFound();
        throw new ConflictException('already_claimed');
      }
      const rows = await this.repo.insertEvents(tx, [
        {
          profileId,
          action: 'claim',
          fromUserId: null,
          toUserId: userId,
          actorUserId: userId,
        },
      ]);
      return firstEvent(rows);
    });
  }

  /** Admin assign (`userId`) or unassign (`null`), over any existing claim. */
  assign(
    profileId: number,
    actorId: number,
    userId: number | null,
  ): Promise<ValheimClaimEvent> {
    return this.repo.transaction(async (tx) => {
      const owner = await this.repo.lockOwner(tx, profileId);
      if (!owner) throw notFound();
      if (userId !== null && !(await this.repo.isActiveUser(tx, userId)))
        throw new BadRequestException('user_not_active');
      await this.repo.setOwner(tx, profileId, userId);
      const rows = await this.repo.insertEvents(tx, [
        {
          profileId,
          action: userId === null ? 'admin_unassign' : 'admin_assign',
          fromUserId: owner.claimedBy,
          toUserId: userId,
          actorUserId: actorId,
        },
      ]);
      return firstEvent(rows);
    });
  }

  /**
   * The character's audit trail, newest first (≤100), with from/to/actor
   * resolved in one batched user lookup (null = no id or user gone).
   */
  async events(profileId: number): Promise<ValheimClaimEvent[]> {
    if (!(await this.repo.profileExists(profileId))) throw notFound();
    const rows = (await this.repo.listEvents(profileId)).map(toClaimEvent);
    const ids = new Set<number>();
    for (const r of rows) {
      for (const id of [r.fromUserId, r.toUserId, r.actorUserId]) {
        if (id !== null) ids.add(id);
      }
    }
    const users = await this.repo.findUsers([...ids]);
    const byId = new Map(users.map((u) => [u.id, toOwner(u)]));
    const pick = (id: number | null) =>
      id === null ? null : (byId.get(id) ?? null);
    return rows.map((r) => ({
      ...r,
      fromUser: pick(r.fromUserId),
      toUser: pick(r.toUserId),
      actor: pick(r.actorUserId),
    }));
  }
}
