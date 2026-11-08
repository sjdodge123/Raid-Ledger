import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { GuildIngameText } from '@raid-ledger/contract';
import { DrizzleAsyncProvider } from '../../../drizzle/drizzle.module';
import {
  GuildAccessService,
  type GuildActor,
} from '../../../guilds/guild-access.service';
import { findGuildKind } from '../../../guilds/guild-core.queries';
import {
  buildIngameTextPatch,
  parseIngameTextPut,
  planIngameTextWrite,
  toIngameTextDto,
} from './guild-ingame-text.helpers';
import {
  findIngameText,
  lockIngameText,
  writeIngameText,
  type Db,
} from './guild-ingame-text.queries';

/**
 * ROK-2136 — the WoW guild's in-game Message of the Day and Guild Information
 * (the hub is the source of truth; officers paste it in game). Reads need
 * `canView` — members + staff, never visitors (OQ-3), 403 before 404; saves
 * arrive behind `GuildEditorGuard`. Only `wow_guild` hubs (404 otherwise).
 */
@Injectable()
export class GuildIngameTextService {
  constructor(
    @Inject(DrizzleAsyncProvider) private readonly db: Db,
    private readonly access: GuildAccessService,
  ) {}

  async get(actor: GuildActor, guildId: number): Promise<GuildIngameText> {
    if (!(await this.access.canView(actor, guildId))) {
      throw new ForbiddenException('Not a member of this guild');
    }
    await this.assertWowGuild(guildId);
    return this.respond(actor, guildId);
  }

  /**
   * D6: writes only the changed fields; 409 carrying the current text when a
   * changed field moved since the editor loaded it. An unchanged save is a
   * 200 no-op (nothing is stamped).
   */
  async save(
    actor: GuildActor,
    guildId: number,
    body: unknown,
  ): Promise<GuildIngameText> {
    const input = parseIngameTextPut(body);
    await this.assertWowGuild(guildId);
    const outcome = await this.db.transaction(async (tx) => {
      const plan = planIngameTextWrite(
        await lockIngameText(tx, guildId),
        input,
      );
      if (plan.outcome === 'conflict') return plan.outcome;
      const patch = buildIngameTextPatch(plan.changes, actor.id, new Date());
      if (patch !== null) await writeIngameText(tx, guildId, patch);
      return plan.outcome;
    });
    const response = await this.respond(actor, guildId);
    if (outcome === 'conflict') {
      throw new ConflictException({
        message: 'Guild text changed',
        ingameText: response,
      });
    }
    return response;
  }

  private async respond(
    actor: GuildActor,
    guildId: number,
  ): Promise<GuildIngameText> {
    const [row, canEdit] = await Promise.all([
      findIngameText(this.db, guildId),
      this.access.canEdit(actor, guildId),
    ]);
    return toIngameTextDto(guildId, row, canEdit);
  }

  private async assertWowGuild(guildId: number): Promise<void> {
    if ((await findGuildKind(this.db, guildId)) !== 'wow_guild') {
      throw new NotFoundException('Guild not found');
    }
  }
}
