import {
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import {
  CreateHubPostSchema,
  HubPostListQuerySchema,
  UpdateHubPostSchema,
  type CreateHubPostResponse,
  type HubPost,
  type HubPostComposer,
  type HubPostList,
  type HubPostRelayChannel,
  type HubPostRelayOutcome,
} from '@raid-ledger/contract';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import { HUB_NOTIFICATION_EVENTS } from '../../notifications/hub-notification.constants';
import { GuildAccessService, type GuildActor } from '../guild-access.service';
import { findGuild } from '../guild-core.queries';
import { findProfileRow, upsertProfile } from '../guild-profile.queries';
import { HubPostRelayService } from './hub-post-relay.service';
import { decodeCursor, encodeCursor, toHubPost } from './hub-posts.helpers';
import {
  deletePost,
  findPost,
  insertPost,
  latestPost,
  listPosts,
  updatePostBody,
  type HubPostRecord,
} from './hub-posts.queries';
import {
  finalBody,
  HUB_POST_RELAY_TIMEOUT_MS,
  parseOrThrow,
  withTimeout,
} from './hub-posts.service.helpers';

/** `LEADER_POST` payload since ROK-1868 — emitted by `create` only. */
export interface HubPostCreatedEvent {
  guildId: number;
  actorId: number;
  postId: number;
  body: string;
}

type Db = PostgresJsDatabase<typeof schema>;

/**
 * ROK-1868 — the hub post feed. Reads need `canView` (403 before 404);
 * writes arrive behind `GuildEditorGuard`. Only `create` notifies (A2) and
 * only `create` relays (D3); a relay failure never rolls a post back (D7).
 */
@Injectable()
export class HubPostsService {
  private readonly logger = new Logger(HubPostsService.name);

  constructor(
    @Inject(DrizzleAsyncProvider) private readonly db: Db,
    private readonly access: GuildAccessService,
    private readonly relay: HubPostRelayService,
    private readonly events: EventEmitter2,
  ) {}

  /** Newest-first page of posts. */
  async list(
    actor: GuildActor,
    guildId: number,
    query: unknown,
  ): Promise<HubPostList> {
    const { limit, cursor } = parseOrThrow(HubPostListQuerySchema, query);
    const after = cursor === undefined ? null : decodeCursor(cursor);
    await this.assertViewable(actor, guildId);
    const page = await listPosts(this.db, guildId, limit, after);
    return {
      posts: page.records.map((r) => this.map(r)),
      nextCursor: page.next ? encodeCursor(page.next) : null,
    };
  }

  /** One post of this guild (another guild's id → 404). */
  async get(
    actor: GuildActor,
    guildId: number,
    postId: number,
  ): Promise<HubPost> {
    await this.assertViewable(actor, guildId);
    return this.map(await this.requirePost(guildId, postId));
  }

  /** The newest post, unchecked — for `GET …/profile` (already gated). */
  async latest(guildId: number): Promise<HubPost | null> {
    const record = await latestPost(this.db, guildId);
    return record ? this.map(record) : null;
  }

  /** The editor's switch default (A4) and where a relay would go. */
  async composer(guildId: number): Promise<HubPostComposer> {
    await this.requireGuild(guildId);
    const stored = await findProfileRow(this.db, guildId);
    return {
      relayDefault: stored?.postRelayDefault ?? false,
      channel: await this.channelFor(guildId),
    };
  }

  /** §2.4 create: insert → remember default → emit → relay (≤ 5 s). */
  async create(
    actor: GuildActor,
    guildId: number,
    input: unknown,
  ): Promise<CreateHubPostResponse> {
    const parsed = parseOrThrow(CreateHubPostSchema, input);
    const body = finalBody(parsed.body);
    const guild = await this.requireGuild(guildId);
    const row = await insertPost(this.db, {
      guildId,
      body,
      authorId: actor.id,
      now: new Date(),
    });
    const channel = await this.channelFor(guildId);
    if (channel.state === 'ok') {
      await this.rememberDefault(guildId, parsed.relayToDiscord);
    }
    this.emitCreated({
      guildId,
      actorId: actor.id,
      postId: row.id,
      body: row.body,
    });
    const record = await this.requirePost(guildId, row.id);
    const relayOutcome = await this.relayOutcome(
      parsed.relayToDiscord,
      channel,
      record,
      guild.name,
    );
    const final =
      relayOutcome === 'sent'
        ? await this.requirePost(guildId, row.id)
        : record;
    return { post: this.map(final), relayOutcome };
  }

  /** Edit the body only — no emit, no Discord call (R1, D3). */
  async update(
    actor: GuildActor,
    guildId: number,
    postId: number,
    input: unknown,
  ): Promise<HubPost> {
    const body = finalBody(parseOrThrow(UpdateHubPostSchema, input).body);
    const current = await this.requirePost(guildId, postId);
    if (current.post.body === body) return this.map(current);
    const target = { guildId, postId };
    const edit = { body, editorId: actor.id, now: new Date() };
    if (!(await updatePostBody(this.db, target, edit))) {
      throw new NotFoundException('Post not found');
    }
    return this.map(await this.requirePost(guildId, postId));
  }

  /** Hard delete (D2); the relayed message goes too, best effort. */
  async remove(guildId: number, postId: number): Promise<void> {
    const deleted = await deletePost(this.db, guildId, postId);
    if (!deleted) throw new NotFoundException('Post not found');
    const { relayChannelId, relayMessageId } = deleted;
    if (relayChannelId && relayMessageId) {
      void this.relay
        .unrelay(relayChannelId, relayMessageId)
        .catch((err: unknown) =>
          this.logger.warn(`Hub post unrelay failed: ${String(err)}`),
        );
    }
  }

  private async relayOutcome(
    requested: boolean,
    channel: HubPostRelayChannel,
    record: HubPostRecord,
    guildName: string,
  ): Promise<HubPostRelayOutcome> {
    if (!requested) return 'not_requested';
    if (channel.state !== 'ok') return 'unavailable';
    const target = {
      guildId: record.post.guildId,
      guildName,
      channelId: channel.channelId,
    };
    const send = this.relay.relay(record, target).catch((err: unknown) => {
      this.logger.warn(`Hub post relay rejected: ${String(err)}`);
      return 'failed' as const;
    });
    return withTimeout(send, HUB_POST_RELAY_TIMEOUT_MS, 'failed');
  }

  private async channelFor(guildId: number): Promise<HubPostRelayChannel> {
    try {
      return await this.relay.availability(guildId);
    } catch (err: unknown) {
      this.logger.warn(`Hub post relay availability failed: ${String(err)}`);
      return { state: 'disconnected' };
    }
  }

  private async rememberDefault(
    guildId: number,
    value: boolean,
  ): Promise<void> {
    await upsertProfile(this.db, guildId, {
      updatedAt: new Date(),
      postRelayDefault: value,
    });
  }

  /** Fire-and-forget (ROK-1832 D10): a listener throw never fails the post. */
  private emitCreated(event: HubPostCreatedEvent): void {
    try {
      this.events.emit(HUB_NOTIFICATION_EVENTS.LEADER_POST, event);
    } catch (err: unknown) {
      this.logger.warn(`Leader-post emit failed: ${String(err)}`);
    }
  }

  private map(record: HubPostRecord): HubPost {
    return toHubPost(record.post, record, this.relay.discordGuildId());
  }

  private async requirePost(
    guildId: number,
    postId: number,
  ): Promise<HubPostRecord> {
    const record = await findPost(this.db, guildId, postId);
    if (!record) throw new NotFoundException('Post not found');
    return record;
  }

  private async requireGuild(guildId: number): Promise<schema.GuildSelect> {
    const guild = await findGuild(this.db, guildId);
    if (!guild) throw new NotFoundException('Guild not found');
    return guild;
  }

  private async assertViewable(
    actor: GuildActor,
    guildId: number,
  ): Promise<void> {
    if (!(await this.access.canView(actor, guildId))) {
      throw new ForbiddenException('Not a member of this guild');
    }
    await this.requireGuild(guildId);
  }
}
