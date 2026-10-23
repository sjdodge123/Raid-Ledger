import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type {
  HubAutoMembershipMode,
  HubInviteJoinResponse,
  HubJoinPromptList,
} from '@raid-ledger/contract';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import { SIGNUP_EVENTS } from '../../discord-bot/discord-bot.constants';
import type { SignupEventPayload } from '../../discord-bot/discord-bot.constants';
import { findGuild } from '../guild-core.queries';
import { CommunityMembershipService } from './community-membership.service';
import { findMembership } from './community-membership.queries';
import { loadDiscordFields } from './community-hub.reads';
import { isInDiscordGuild } from './discord-guild-member.helpers';
import {
  decideAutoMembership,
  isRecruitingHub,
  type AutoMembershipAction,
} from './hub-auto-membership.decision';
import { HubDiscordInviteService } from './invites/hub-discord-invite.service';
import * as q from './hub-join-prompts.queries';

/**
 * ROK-1893 P1 (§8b/§8d) — per-hub auto-membership. A signup on an event
 * tagged to a community hub either asks the signer "Join <hub>?" (`suggest`)
 * or joins them and tells them once (`auto`). Runs on the post-commit
 * `SIGNUP_EVENTS.CREATED` emit, so it never sits inside — or fails — the
 * signup transaction.
 */
@Injectable()
export class HubAutoMembershipService {
  private readonly logger = new Logger(HubAutoMembershipService.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly membership: CommunityMembershipService,
    private readonly discordInvite: HubDiscordInviteService,
  ) {}

  @OnEvent(SIGNUP_EVENTS.CREATED)
  async onSignupCreated(payload: SignupEventPayload): Promise<void> {
    await this.safely(payload);
  }

  /** ROK-1769 re-signups (a departed row reactivated) count as signups. */
  @OnEvent(SIGNUP_EVENTS.UPDATED)
  async onSignupUpdated(payload: SignupEventPayload): Promise<void> {
    if (payload.action === 'signup_reactivated') await this.safely(payload);
  }

  /** Never throws: a failure is logged and the signup stands. */
  private async safely(payload: SignupEventPayload): Promise<void> {
    const userId = payload.userId;
    if (userId === null || userId === undefined) return;
    try {
      await this.onSignup(payload.eventId, userId);
    } catch (err) {
      this.logger.warn(
        `auto-membership skipped for event ${payload.eventId} user ${userId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /** Apply the §8d rule for one signup; returns what it did. */
  async onSignup(
    eventId: number,
    userId: number,
  ): Promise<AutoMembershipAction> {
    const hub = await q.findEventHub(this.db, eventId);
    if (!isRecruitingHub(hub)) return 'none';
    const [membership, prompt, discord] = await Promise.all([
      findMembership(this.db, hub.hubId, userId),
      q.findPrompt(this.db, hub.hubId, userId),
      loadDiscordFields(this.db, userId),
    ]);
    const inDiscord = discord !== null && isInDiscordGuild(discord);
    const action = decideAutoMembership({ hub, membership, prompt, inDiscord });
    const src = { source: 'signup' as const, sourceRef: eventId };
    if (action === 'suggest') {
      await q.insertSuggestPrompt(this.db, hub.hubId, userId, src);
    } else if (action === 'auto') {
      const res = await this.membership.joinVia(userId, hub.hubId, 'auto', {
        requireDiscord: true,
      });
      if (res.joined)
        await q.upsertAutoJoinedPrompt(this.db, hub.hubId, userId, src);
    }
    return action;
  }

  /** PATCH /hubs/:id/auto-membership — the route guard admits Leader/staff. */
  async setMode(
    hubId: number,
    mode: HubAutoMembershipMode,
  ): Promise<{ mode: HubAutoMembershipMode }> {
    const hub = await findGuild(this.db, hubId);
    if (!hub) throw new NotFoundException('Guild not found');
    if (hub.kind !== 'game_community')
      throw new BadRequestException(
        'Auto-membership applies to community hubs only',
      );
    await q.setAutoMembership(this.db, hubId, mode);
    return { mode };
  }

  /**
   * GET /users/me/hub-join-prompts — plus the viewer's Discord state: a
   * `suggest` Join needs the community Discord server (no staff bypass), so
   * the card swaps Join for "Join the Discord server first" + a bot-made
   * server invite (minted only when one would be shown).
   */
  async listMine(userId: number): Promise<HubJoinPromptList> {
    const items = await q.listOpenPrompts(this.db, userId);
    const fields = await loadDiscordFields(this.db, userId);
    const inDiscordServer = fields !== null && isInDiscordGuild(fields);
    const suggest = items.find((p) => p.kind === 'suggest');
    const discordServerInviteUrl =
      !inDiscordServer && suggest
        ? await this.discordInvite.serverInviteUrl(suggest.hubId)
        : null;
    return { items, inDiscordServer, discordServerInviteUrl };
  }

  /** POST …/:id/accept — `suggest` joins (source `prompt`); both dismiss. */
  async accept(userId: number, id: number): Promise<HubInviteJoinResponse> {
    const prompt = await this.ownPrompt(userId, id);
    const hubId = prompt.guildId;
    const res =
      prompt.kind === 'suggest'
        ? await this.membership.joinVia(userId, hubId, 'prompt', {
            requireDiscord: true,
          })
        : { joined: false, memberCount: await this.liveCount(hubId) };
    await q.dismissPrompt(this.db, id);
    return { hubId, ...res };
  }

  /** POST …/:id/dismiss — "Not now" / acknowledge; sticks. */
  async dismiss(userId: number, id: number): Promise<void> {
    await this.ownPrompt(userId, id);
    await q.dismissPrompt(this.db, id);
  }

  private async ownPrompt(
    userId: number,
    id: number,
  ): Promise<q.HubJoinPromptRow> {
    const row = await q.findOwnPrompt(this.db, id, userId);
    if (!row) throw new NotFoundException('Prompt not found');
    return row;
  }

  private async liveCount(hubId: number): Promise<number> {
    return (await findGuild(this.db, hubId))?.memberCount ?? 0;
  }
}
