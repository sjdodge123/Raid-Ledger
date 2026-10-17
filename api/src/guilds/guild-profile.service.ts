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
  dropUnchangedGmPost,
  toGuildProfile,
} from './guild-profile.helpers';
import {
  findProfileRow,
  findUsername,
  upsertProfile,
} from './guild-profile.queries';
import { findGuild } from './guild-core.queries';

/**
 * ROK-1786 — the guild's GM post, rules and links. Reads need `canView`
 * (403 before 404, like `GET :id`); writes arrive behind `GuildEditorGuard`.
 */
@Injectable()
export class GuildProfileService {
  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly access: GuildAccessService,
  ) {}

  async get(actor: GuildActor, guildId: number): Promise<GuildProfile> {
    if (!(await this.access.canView(actor, guildId))) {
      throw new ForbiddenException('Not a member of this guild');
    }
    await this.assertGuild(guildId);
    return this.load(guildId);
  }

  /** Upsert; the GM post stamp moves only when its text changes. */
  async update(
    actor: GuildActor,
    guildId: number,
    body: unknown,
  ): Promise<GuildProfile> {
    const input = parseUpdate(body);
    await this.assertGuild(guildId);
    const stored = await findProfileRow(this.db, guildId);
    const patch = dropUnchangedGmPost(
      buildProfilePatch(input, actor.id, new Date()),
      stored?.gmPost,
    );
    await upsertProfile(this.db, guildId, patch);
    return this.load(guildId);
  }

  private async load(guildId: number): Promise<GuildProfile> {
    const row = await findProfileRow(this.db, guildId);
    const by = await findUsername(this.db, row?.gmPostUpdatedBy ?? null);
    return toGuildProfile(guildId, row, by);
  }

  private async assertGuild(guildId: number): Promise<void> {
    if (!(await findGuild(this.db, guildId))) {
      throw new NotFoundException('Guild not found');
    }
  }
}

function parseUpdate(body: unknown): UpdateGuildProfileInput {
  const parsed = UpdateGuildProfileSchema.safeParse(body);
  if (!parsed.success) {
    throw new BadRequestException(parsed.error.flatten().fieldErrors);
  }
  return parsed.data;
}
