import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { ValheimClaimEvent } from '@raid-ledger/contract';
import type { ValheimProfileClaimEventRow } from '../../../../drizzle/schema';
import { ValheimIdentityRepository } from './valheim-identity.repository';

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

  /** The character's audit trail, newest first (≤100). */
  async events(profileId: number): Promise<ValheimClaimEvent[]> {
    if (!(await this.repo.profileExists(profileId))) throw notFound();
    return (await this.repo.listEvents(profileId)).map(toClaimEvent);
  }
}
