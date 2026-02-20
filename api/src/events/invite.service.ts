import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  BadRequestException,
  Optional,
} from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import { SignupsService } from './signups.service';
import { PugInviteService } from '../discord-bot/services/pug-invite.service';
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
    private readonly pugInviteService: PugInviteService | null,
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

    // Resolve game info — prefer IGDB coverUrl, fallback to registry iconUrl
    let game: {
      name: string;
      coverUrl?: string | null;
      hasRoles?: boolean;
    } | null = null;
    if (event.registryGameId) {
      const [registryRow] = await this.db
        .select({
          name: schema.gameRegistry.name,
          iconUrl: schema.gameRegistry.iconUrl,
          hasRoles: schema.gameRegistry.hasRoles,
        })
        .from(schema.gameRegistry)
        .where(eq(schema.gameRegistry.id, event.registryGameId))
        .limit(1);

      // Also check IGDB games table for higher-quality cover art
      let igdbCoverUrl: string | null = null;
      if (event.gameId) {
        const gameId = parseInt(String(event.gameId), 10);
        if (!isNaN(gameId)) {
          const [igdbGame] = await this.db
            .select({ coverUrl: schema.games.coverUrl })
            .from(schema.games)
            .where(eq(schema.games.igdbId, gameId))
            .limit(1);
          igdbCoverUrl = igdbGame?.coverUrl ?? null;
        }
      }

      if (registryRow) {
        game = {
          name: registryRow.name,
          coverUrl: igdbCoverUrl || registryRow.iconUrl,
          hasRoles: registryRow.hasRoles,
        };
      }
    } else if (event.gameId) {
      // IGDB-only event (no registry entry) — resolve name + cover from IGDB
      const gameId = parseInt(String(event.gameId), 10);
      if (!isNaN(gameId)) {
        const [igdbGame] = await this.db
          .select({
            name: schema.games.name,
            coverUrl: schema.games.coverUrl,
          })
          .from(schema.games)
          .where(eq(schema.games.igdbId, gameId))
          .limit(1);
        if (igdbGame) {
          game = {
            name: igdbGame.name,
            coverUrl: igdbGame.coverUrl,
            hasRoles: false,
          };
        }
      }
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
        role: slot.role as 'tank' | 'healer' | 'dps',
        status: slot.status as 'pending' | 'invited' | 'accepted' | 'claimed',
      },
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
    roleOverride?: 'tank' | 'healer' | 'dps',
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

    // Use role override from user selection, falling back to slot's preset role (ROK-394)
    const effectiveRole =
      roleOverride ?? (slot.role as 'tank' | 'healer' | 'dps');

    if (user?.discordId) {
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

      return {
        type: 'signup',
        eventId: slot.eventId,
        discordServerInviteUrl: discordServerInviteUrl ?? undefined,
      };
    }

    // No Discord ID — claim the PUG slot directly
    await this.db
      .update(schema.pugSlots)
      .set({
        claimedByUserId: userId,
        status: 'claimed',
        updatedAt: new Date(),
      })
      .where(eq(schema.pugSlots.id, slot.id));

    this.logger.log(
      'Invite %s claimed by user %d (PUG slot) for event %d',
      code,
      userId,
      slot.eventId,
    );

    return { type: 'claimed', eventId: slot.eventId };
  }

  /**
   * Try to generate a Discord server invite URL for claim responses (ROK-394).
   * Only generates if PugInviteService is available and user is not already in the server.
   */
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
}
