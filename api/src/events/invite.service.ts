import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  forwardRef,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import { SignupsService } from './signups.service';
import { PugInviteService } from '../discord-bot/services/pug-invite.service';
import { DiscordBotClientService } from '../discord-bot/discord-bot-client.service';
import { SettingsService } from '../settings/settings.service';
import {
  findSlotByCode,
  findEventForSlot,
  validateSlotNotClaimed,
  validateEventAvailable,
  resolveGameInfo,
  assertSlotClaimable,
  findClaimEventOrThrow,
  checkNotAlreadySignedUp,
  buildPostClaimDm,
} from './invite.helpers';
import {
  findEventByShareCode,
  findShareEventOrThrow,
  defaultShareClaimRole,
  materialiseClaimedPugSlot,
  type ClaimRole,
} from './invite-share.helpers';
import type { InviteCodeResolveResponseDto } from '@raid-ledger/contract';

@Injectable()
export class InviteService {
  private readonly logger = new Logger(InviteService.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private db: PostgresJsDatabase<typeof schema>,
    private readonly signupsService: SignupsService,
    @Optional()
    @Inject(forwardRef(() => PugInviteService))
    private readonly pugInviteService: PugInviteService | null,
    @Optional()
    @Inject(forwardRef(() => DiscordBotClientService))
    private readonly discordClient: DiscordBotClientService | null,
    private readonly settingsService: SettingsService,
  ) {}

  /**
   * Resolve an invite code for the public landing page.
   *
   * ROK-1631: this path is unauthenticated, so it must not create a Discord
   * server invite. The server invite is minted on the authenticated claim
   * paths instead, and returned in the claim response.
   */
  async resolveInvite(code: string): Promise<InviteCodeResolveResponseDto> {
    const slot = await findSlotByCode(this.db, code);
    if (!slot) return this.resolveShareInvite(code);
    const claimedErr = validateSlotNotClaimed(slot);
    if (claimedErr) return { valid: false, error: claimedErr };
    const event = await findEventForSlot(this.db, slot.eventId);
    const eventErr = validateEventAvailable(event);
    if (eventErr || !event) return { valid: false, error: eventErr! };
    return this.buildResolveResponse(slot, event);
  }

  /** Resolve an event-level share link (ROK-1621) — no slot row involved. */
  private async resolveShareInvite(
    code: string,
  ): Promise<InviteCodeResolveResponseDto> {
    const event = await findEventByShareCode(this.db, code);
    if (!event) return { valid: false, error: 'Invite not found' };
    const unavailable = validateEventAvailable(event);
    if (unavailable) return { valid: false, error: unavailable };
    return this.buildResolveResponse(null, event);
  }

  private async buildResolveResponse(
    slot: Awaited<ReturnType<typeof findSlotByCode>>,
    event: typeof schema.events.$inferSelect,
  ): Promise<InviteCodeResolveResponseDto> {
    const game = await resolveGameInfo(
      this.db,
      event,
      slot?.createdBy ?? event.creatorId,
    );
    const communityName = await this.tryGetCommunityName();
    return {
      valid: true,
      event: {
        id: event.id,
        title: event.title,
        startTime: event.duration[0].toISOString(),
        endTime: event.duration[1].toISOString(),
        game,
      },
      slot: slot
        ? {
            id: slot.id,
            role: slot.role as ClaimRole,
            status: slot.status as
              'pending' | 'invited' | 'accepted' | 'claimed',
          }
        : undefined,
      communityName: communityName ?? undefined,
    };
  }

  async claimInvite(
    code: string,
    userId: number,
    roleOverride?: 'tank' | 'healer' | 'dps' | 'player',
    characterId?: string,
  ): Promise<{
    type: 'signup' | 'claimed';
    eventId: number;
    discordServerInviteUrl?: string;
  }> {
    const slot = await findSlotByCode(this.db, code);
    if (!slot) {
      return this.claimShareInvite(code, userId, roleOverride, characterId);
    }
    assertSlotClaimable(slot);
    const event = await findClaimEventOrThrow(this.db, slot.eventId);
    await checkNotAlreadySignedUp(this.db, slot.eventId, userId, slot.id);
    const user = await this.findUserOrThrow(userId);
    const role =
      roleOverride ?? (slot.role as 'tank' | 'healer' | 'dps' | 'player');
    return user.discordId
      ? this.claimAsMember(slot, event, userId, role, characterId, code)
      : this.claimAsPug(slot, event, userId, role, characterId, code);
  }

  /**
   * Claim an event-level share link (ROK-1621).
   * Members get a plain signup; a guest with no Discord account gets the guest
   * roster row materialised here — never at link-generation time.
   */
  private async claimShareInvite(
    code: string,
    userId: number,
    roleOverride: ClaimRole | undefined,
    characterId: string | undefined,
  ) {
    const event = await findShareEventOrThrow(this.db, code);
    const user = await this.findUserOrThrow(userId);
    const role = roleOverride ?? defaultShareClaimRole(event);
    await this.createSignupForClaim(event.id, userId, role, characterId);
    if (!user.discordId) {
      await materialiseClaimedPugSlot(this.db, event, userId, role);
    }
    this.logger.log(
      'Share invite %s claimed by user %d for event %d',
      code,
      userId,
      event.id,
    );
    this.sendPostClaimDM(userId, event.title, event.id).catch(() => {});
    const discordServerInviteUrl = await this.tryGenerateServerInvite(event.id);
    return {
      type: user.discordId ? ('signup' as const) : ('claimed' as const),
      eventId: event.id,
      discordServerInviteUrl: discordServerInviteUrl ?? undefined,
    };
  }

  private async claimAsMember(
    slot: { id: string; eventId: number },
    event: { title: string },
    userId: number,
    role: 'tank' | 'healer' | 'dps' | 'player',
    characterId: string | undefined,
    code: string,
  ) {
    await this.createSignupForClaim(slot.eventId, userId, role, characterId);
    await this.db
      .delete(schema.pugSlots)
      .where(eq(schema.pugSlots.id, slot.id));
    this.logger.log(
      'Invite %s claimed by member (user %d) — created normal signup for event %d',
      code,
      userId,
      slot.eventId,
    );
    const discordServerInviteUrl = await this.tryGenerateServerInvite(
      slot.eventId,
    );
    this.sendPostClaimDM(userId, event.title, slot.eventId).catch(() => {});
    return {
      type: 'signup' as const,
      eventId: slot.eventId,
      discordServerInviteUrl: discordServerInviteUrl ?? undefined,
    };
  }

  private async claimAsPug(
    slot: { id: string; eventId: number },
    event: { title: string },
    userId: number,
    role: 'tank' | 'healer' | 'dps' | 'player',
    characterId: string | undefined,
    code: string,
  ) {
    await this.createSignupForClaim(slot.eventId, userId, role, characterId);
    await this.markSlotClaimed(slot.id, userId);
    this.logger.log(
      'Invite %s claimed by user %d (PUG slot + signup) for event %d',
      code,
      userId,
      slot.eventId,
    );
    this.sendPostClaimDM(userId, event.title, slot.eventId).catch(() => {});
    // ROK-1631: the resolve response no longer carries a server invite, so
    // this path mints its own rather than relying on the landing page's copy.
    const discordServerInviteUrl = await this.tryGenerateServerInvite(
      slot.eventId,
    );
    return {
      type: 'claimed' as const,
      eventId: slot.eventId,
      discordServerInviteUrl: discordServerInviteUrl ?? undefined,
    };
  }

  /** Mark a PUG slot as claimed by the given user. */
  private async markSlotClaimed(slotId: string, userId: number): Promise<void> {
    await this.db
      .update(schema.pugSlots)
      .set({
        claimedByUserId: userId,
        status: 'claimed',
        updatedAt: new Date(),
      })
      .where(eq(schema.pugSlots.id, slotId));
  }

  private async createSignupForClaim(
    eventId: number,
    userId: number,
    role: 'tank' | 'healer' | 'dps' | 'player',
    characterId: string | undefined,
  ) {
    try {
      await this.signupsService.signup(eventId, userId, {
        slotRole: role,
        characterId,
      });
    } catch (err) {
      this.logger.warn(
        'Failed to create signup for invite claim: %s',
        err instanceof Error ? err.message : 'Unknown error',
      );
      throw err;
    }
  }

  private async findUserOrThrow(userId: number) {
    const [user] = await this.db
      .select({ discordId: schema.users.discordId })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);
    if (!user) {
      throw new NotFoundException(
        `User ${userId} not found — cannot claim invite`,
      );
    }
    return user;
  }

  private async sendPostClaimDM(
    userId: number,
    eventTitle: string,
    eventId: number,
  ): Promise<void> {
    if (!this.discordClient || !this.discordClient.isConnected()) return;
    const [user] = await this.db
      .select({ discordId: schema.users.discordId })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);
    if (!user?.discordId) return;
    const clientUrl = await this.settingsService.getTrustedClientUrl();
    const message = buildPostClaimDm(eventTitle, eventId, clientUrl);
    await this.discordClient.sendDirectMessage(user.discordId, message);
    this.logger.log(
      'Sent post-claim DM to user %d for event %d',
      userId,
      eventId,
    );
  }

  private async tryGenerateServerInvite(
    eventId: number,
  ): Promise<string | null> {
    if (!this.pugInviteService) return null;
    try {
      return await this.pugInviteService.generateServerInvite(eventId);
    } catch (err) {
      this.logger.warn(
        'Failed to generate server invite for claim response: %s',
        err instanceof Error ? err.message : 'Unknown error',
      );
      return null;
    }
  }

  private async tryGetCommunityName(): Promise<string | null> {
    try {
      const branding = await this.settingsService.getBranding();
      return branding.communityName;
    } catch {
      return null;
    }
  }
}
