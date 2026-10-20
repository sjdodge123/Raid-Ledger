import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import {
  UpdateGuildProfileSchema,
  type GuildProfile,
  type UpdateGuildProfileInput,
} from '@raid-ledger/contract';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import { GuildAccessService, type GuildActor } from './guild-access.service';
import {
  buildProfilePatch,
  toGuildProfile,
  withLatestPost,
} from './guild-profile.helpers';
import { findProfileRow, upsertProfile } from './guild-profile.queries';
import { findGuild } from './guild-core.queries';
import { HubPostsService } from './posts/hub-posts.service';

/** ROK-1868 A3 / OQ-6: the legacy GM-post write answers 400 with this. */
export const GM_POST_MOVED_MESSAGE =
  'The leader post moved to POST /guilds/:id/posts';

/**
 * ROK-1786 — the guild's GM post, rules and links. Reads need `canView`
 * (403 before 404, like `GET :id`); writes arrive behind `GuildEditorGuard`.
 * ROK-1868 A3: `gmPost` is derived from the newest hub post (`latestPost`
 * rides along); the legacy `gm_post` columns are never read or written.
 */
@Injectable()
export class GuildProfileService {
  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly access: GuildAccessService,
    private readonly posts: HubPostsService,
  ) {}

  async get(actor: GuildActor, guildId: number): Promise<GuildProfile> {
    if (!(await this.access.canView(actor, guildId))) {
      throw new ForbiddenException('Not a member of this guild');
    }
    await this.assertGuild(guildId);
    return this.load(guildId);
  }

  /**
   * Upsert rules / links. A `gmPost` key is rejected (A3) — posts are
   * written through `POST /guilds/:id/posts`, which is the only notify site.
   */
  async update(
    actor: GuildActor,
    guildId: number,
    body: unknown,
  ): Promise<GuildProfile> {
    if (hasGmPostKey(body))
      throw new BadRequestException(GM_POST_MOVED_MESSAGE);
    const input = parseUpdate(body);
    await this.assertGuild(guildId);
    await upsertProfile(
      this.db,
      guildId,
      buildProfilePatch(input, actor.id, new Date()),
    );
    return this.load(guildId);
  }

  private async load(guildId: number): Promise<GuildProfile> {
    const [row, latest] = await Promise.all([
      findProfileRow(this.db, guildId),
      this.posts.latest(guildId),
    ]);
    return withLatestPost(toGuildProfile(guildId, row, null), latest);
  }

  private async assertGuild(guildId: number): Promise<void> {
    if (!(await findGuild(this.db, guildId))) {
      throw new NotFoundException('Guild not found');
    }
  }
}

function hasGmPostKey(body: unknown): boolean {
  return typeof body === 'object' && body !== null && 'gmPost' in body;
}

function parseUpdate(body: unknown): UpdateGuildProfileInput {
  const parsed = UpdateGuildProfileSchema.safeParse(body);
  if (!parsed.success) {
    throw new BadRequestException(parsed.error.flatten().fieldErrors);
  }
  return parsed.data;
}
