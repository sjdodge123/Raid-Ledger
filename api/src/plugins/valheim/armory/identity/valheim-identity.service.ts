import { Injectable } from '@nestjs/common';
import type {
  NewValheimProfileClaimEvent,
  ValheimProfileRow,
} from '../../../../drizzle/schema';
import type { ValheimLinkTx } from '../../link/valheim-link-token-lock';
import type { ValheimProfileUpsertedHook } from '../valheim-armory-profile.hook';
import { ValheimIdentityRepository } from './valheim-identity.repository';

/** A system-actor (Steam auto-match) audit row. */
function systemEvent(
  profileId: number,
  action: 'auto_attach' | 'auto_detach',
  userId: number,
): NewValheimProfileClaimEvent {
  const attach = action === 'auto_attach';
  return {
    profileId,
    action,
    fromUserId: attach ? null : userId,
    toUserId: attach ? userId : null,
    actorUserId: null,
  };
}

/**
 * ROK-1835 L3 Steam auto-match (identity rules A1–A3). Trust boundary R5:
 * the mod-asserted SteamID64 only ever matches `users.steam_id`, which Raid
 * Ledger's own Steam OpenID link writes; it never creates or edits a user.
 * Auto-match only fills `claimed_by IS NULL` — a manual/admin claim is never
 * displaced (D7). A forged SteamID can misattribute a character on the
 * asserting server only (accepted residual, Q1); admins can unassign.
 */
@Injectable()
export class ValheimIdentityService implements ValheimProfileUpsertedHook {
  constructor(private readonly repo: ValheimIdentityRepository) {}

  /** A1 — the importer's in-tx hook after a profile upsert. */
  async onProfileUpserted(
    tx: ValheimLinkTx,
    profile: ValheimProfileRow,
  ): Promise<void> {
    if (profile.claimedBy !== null) return;
    const userId = await this.repo.autoAttachProfile(tx, profile.id);
    if (userId === null) return;
    await this.repo.insertEvents(tx, [
      systemEvent(profile.id, 'auto_attach', userId),
    ]);
  }

  /** A2 — the user verified `steamId64` through RL's Steam auth. */
  attachForUser(userId: number, steamId64: string): Promise<void> {
    return this.repo.transaction(async (tx) => {
      const ids = await this.repo.attachBySteamId(tx, userId, steamId64);
      if (ids.length === 0) return;
      await this.repo.insertEvents(
        tx,
        ids.map((id) => systemEvent(id, 'auto_attach', userId)),
      );
    });
  }

  /** A3 — the user unlinked `steamId64`; only `auto` claims detach. */
  detachForUser(userId: number, steamId64: string): Promise<void> {
    return this.repo.transaction(async (tx) => {
      const ids = await this.repo.detachAutoBySteamId(tx, userId, steamId64);
      if (ids.length === 0) return;
      await this.repo.insertEvents(
        tx,
        ids.map((id) => systemEvent(id, 'auto_detach', userId)),
      );
    });
  }
}
