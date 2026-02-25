import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  BadRequestException,
  Optional,
  forwardRef,
} from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import { SignupsService } from './signups.service';
import { PugInviteService } from '../discord-bot/services/pug-invite.service';
import { DiscordBotClientService } from '../discord-bot/discord-bot-client.service';
import { SettingsService } from '../settings/settings.service';
import type { InviteCodeResolveResponseDto } from '@raid-ledger/contract';

/**
 * Service for handling magic invite link resolution and claiming (ROK-263).
 */
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
   * Resolve an invite code — return event + slot context.
   * Public (no auth required).
   */
  async resolveInvite(code: string): Promise<InviteCodeResolveResponseDto> {
    const [slot] = await this.db
      .select()
      .from(schema.pugSlots)
      .where(eq(schema.pugSlots.inviteCode, code))
      .limit(1);

    if (!slot) {
      return { valid: false, error: 'Invite not found' };
    }

    // Check if already claimed or cancelled
    if (slot.status === 'accepted' || slot.status === 'claimed') {
      return { valid: false, error: 'This invite has already been claimed' };
    }

    // Fetch event
    const [event] = await this.db
      .select()
      .from(schema.events)
      .where(eq(schema.events.id, slot.eventId))
      .limit(1);

    if (!event) {
      return { valid: false, error: 'Event not found' };
    }

    if (event.cancelledAt) {
      return { valid: false, error: 'This event has been cancelled' };
    }

    // Check if event is in the past
    const endTime = event.duration[1];
    if (endTime < new Date()) {
      return { valid: false, error: 'This event has already ended' };
    }

    // ROK-400: Resolve game info directly from unified games table
    const BLIZZARD_SLUGS = ['world-of-warcraft', 'world-of-warcraft-classic'];
    let game: {
      name: string;
      coverUrl?: string | null;
      hasRoles?: boolean;
      gameId?: number;
      isBlizzardGame?: boolean;
      inviterRealm?: string | null;
      gameVariant?: string | null;
    } | null = null;
    if (event.gameId) {
      const [gameRow] = await this.db
        .select({
          id: schema.games.id,
          name: schema.games.name,
          coverUrl: schema.games.coverUrl,
          hasRoles: schema.games.hasRoles,
          slug: schema.games.slug,
        })
        .from(schema.games)
        .where(eq(schema.games.id, event.gameId))
        .limit(1);

      if (gameRow) {
        const isBlizzardGame = BLIZZARD_SLUGS.some((s) => gameRow.slug === s);

        // Look up inviter's character for realm/gameVariant hints
        let inviterRealm: string | null = null;
        let gameVariant: string | null = null;
        if (isBlizzardGame) {
          const [inviterChar] = await this.db
            .select({
              realm: schema.characters.realm,
              gameVariant: schema.characters.gameVariant,
            })
            .from(schema.characters)
            .where(
              and(
                eq(schema.characters.userId, slot.createdBy),
                eq(schema.characters.gameId, event.gameId),
              ),
            )
            .limit(1);
          inviterRealm = inviterChar?.realm ?? null;
          gameVariant = inviterChar?.gameVariant ?? null;
        }

        game = {
          name: gameRow.name,
          coverUrl: gameRow.coverUrl,
          hasRoles: gameRow.hasRoles,
          gameId: gameRow.id,
          isBlizzardGame,
          inviterRealm,
          gameVariant,
        };
      }
    }

    // Generate Discord server invite for the invite page (ROK-394)
    const discordServerInviteUrl = await this.tryGenerateServerInvite(
      slot.eventId,
    );

    // Fetch community name for Discord button labels (ROK-394)
    let communityName: string | null = null;
    try {
      const branding = await this.settingsService.getBranding();
      communityName = branding.communityName;
    } catch {
      // Ignore — communityName is optional
    }

    return {
      valid: true,
      event: {
        id: event.id,
        title: event.title,
        startTime: event.duration[0].toISOString(),
        endTime: event.duration[1].toISOString(),
        game,
      },
      slot: {
        id: slot.id,
        role: slot.role as 'tank' | 'healer' | 'dps' | 'player',
        status: slot.status as 'pending' | 'invited' | 'accepted' | 'claimed',
      },
      discordServerInviteUrl: discordServerInviteUrl ?? undefined,
      communityName: communityName ?? undefined,
    };
  }

  /**
   * Claim an invite code — smart matching:
   * 1. User has RL account with Discord ID? -> create normal signup, delete PUG slot
   * 2. New user? -> claim PUG slot, set claimedByUserId
   * 3. Already signed up? -> return error
   *
   * Returns discordServerInviteUrl for external PUG users who may need
   * to join the Discord server (ROK-394).
   */
  async claimInvite(
    code: string,
    userId: number,
    roleOverride?: 'tank' | 'healer' | 'dps' | 'player',
  ): Promise<{
    type: 'signup' | 'claimed';
    eventId: number;
    discordServerInviteUrl?: string;
  }> {
    const [slot] = await this.db
      .select()
      .from(schema.pugSlots)
      .where(eq(schema.pugSlots.inviteCode, code))
      .limit(1);

    if (!slot) {
      throw new NotFoundException('Invite not found');
    }

    if (slot.status === 'accepted' || slot.status === 'claimed') {
      throw new ConflictException('This invite has already been claimed');
    }

    // Check event validity
    const [event] = await this.db
      .select()
      .from(schema.events)
      .where(eq(schema.events.id, slot.eventId))
      .limit(1);

    if (!event || event.cancelledAt) {
      throw new BadRequestException('Event is not available');
    }

    const endTime = event.duration[1];
    if (endTime < new Date()) {
      throw new BadRequestException('This event has already ended');
    }

    // Check if user is already signed up
    const [existingSignup] = await this.db
      .select({ id: schema.eventSignups.id })
      .from(schema.eventSignups)
      .where(
        and(
          eq(schema.eventSignups.eventId, slot.eventId),
          eq(schema.eventSignups.userId, userId),
        ),
      )
      .limit(1);

    if (existingSignup) {
      // Clean up the anonymous PUG slot since user is already signed up
      await this.db
        .delete(schema.pugSlots)
        .where(eq(schema.pugSlots.id, slot.id));
      throw new ConflictException('You are already signed up for this event');
    }

    // Smart matching: user has a Discord ID -> create normal signup
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

    // Use role override from user selection, falling back to slot's preset role (ROK-394)
    const effectiveRole =
      roleOverride ?? (slot.role as 'tank' | 'healer' | 'dps' | 'player');

    if (user.discordId) {
      // Existing RL member — create normal signup, delete PUG slot
      try {
        await this.signupsService.signup(slot.eventId, userId, {
          slotRole: effectiveRole,
        });
      } catch (err) {
        this.logger.warn(
          'Failed to create signup for invite claim: %s',
          err instanceof Error ? err.message : 'Unknown error',
        );
        throw err;
      }

      // Delete the PUG slot
      await this.db
        .delete(schema.pugSlots)
        .where(eq(schema.pugSlots.id, slot.id));

      this.logger.log(
        'Invite %s claimed by member (user %d) — created normal signup for event %d',
        code,
        userId,
        slot.eventId,
      );

      // Generate Discord server invite for PUG users who might not be in the server (ROK-394)
      const discordServerInviteUrl = await this.tryGenerateServerInvite(
        slot.eventId,
      );

      // Fire-and-forget post-claim DM (ROK-394)
      this.sendPostClaimDM(userId, event.title, slot.eventId).catch(() => {});

      return {
        type: 'signup',
        eventId: slot.eventId,
        discordServerInviteUrl: discordServerInviteUrl ?? undefined,
      };
    }

    // No Discord ID — claim the PUG slot and create signup so user appears in roster
    await this.db
      .update(schema.pugSlots)
      .set({
        claimedByUserId: userId,
        status: 'claimed',
        updatedAt: new Date(),
      })
      .where(eq(schema.pugSlots.id, slot.id));

    // ROK-488: Create event signup so the player appears in the roster UI
    try {
      await this.signupsService.signup(slot.eventId, userId, {
        slotRole: effectiveRole,
      });
    } catch (err) {
      this.logger.warn(
        'Failed to create signup for PUG claim (no discordId): %s',
        err instanceof Error ? err.message : 'Unknown error',
      );
      throw err;
    }

    this.logger.log(
      'Invite %s claimed by user %d (PUG slot + signup) for event %d',
      code,
      userId,
      slot.eventId,
    );

    // Fire-and-forget post-claim DM (ROK-394)
    this.sendPostClaimDM(userId, event.title, slot.eventId).catch(() => {});

    return { type: 'claimed', eventId: slot.eventId };
  }

  /**
   * Send a post-claim DM with event link and voice channel info (ROK-394 step 5).
   * Fire-and-forget — caller should `.catch(() => {})`.
   */
  private async sendPostClaimDM(
    userId: number,
    eventTitle: string,
    eventId: number,
  ): Promise<void> {
    if (!this.discordClient || !this.discordClient.isConnected()) return;

    // Look up user's discordId
    const [user] = await this.db
      .select({ discordId: schema.users.discordId })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);

    if (!user?.discordId) return;

    const clientUrl =
      (await this.settingsService.getClientUrl()) ?? 'http://localhost:5173';
    const eventUrl = `${clientUrl}/events/${eventId}`;
    const message = [
      `You have joined **${eventTitle}**!`,
      `View the event: ${eventUrl}`,
    ].join('\n');

    await this.discordClient.sendDirectMessage(user.discordId, message);
    this.logger.log(
      'Sent post-claim DM to user %d for event %d',
      userId,
      eventId,
    );
  }

  /**
   * Try to generate a Discord server invite URL for claim responses (ROK-394).
   * Only generates if PugInviteService is available and user is not already in the server.
   */
  private async tryGenerateServerInvite(
    eventId: number,
  ): Promise<string | null> {
    this.logger.debug(
      'tryGenerateServerInvite: pugInviteService available = %s',
      !!this.pugInviteService,
    );
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
}
