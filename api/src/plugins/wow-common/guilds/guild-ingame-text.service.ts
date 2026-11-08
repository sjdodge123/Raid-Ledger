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
  adoptPutBody,
  gameFieldOf,
  parseIngameFieldKey,
  toGameTextDto,
} from './guild-ingame-game-text.helpers';
import {
  acknowledgeGameText,
  findGameText,
} from './guild-ingame-game-text.queries';
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

  /**
   * ROK-2137 Adopt (editors, behind `GuildEditorGuard`): copy the field's
   * last in-game report into the hub text through `save` — same validation,
   * per-field 409 and attribution. 409 when the field was never reported.
   */
  async adopt(
    actor: GuildActor,
    guildId: number,
    rawField: string,
  ): Promise<GuildIngameText> {
    const field = parseIngameFieldKey(rawField);
    await this.assertWowGuild(guildId);
    const [game, hub] = await Promise.all([
      findGameText(this.db, guildId),
      findIngameText(this.db, guildId),
    ]);
    const report = gameFieldOf(game, field);
    if (report.reportedAt === null) throw noReport();
    const text = field === 'motd' ? hub?.motd : hub?.info;
    const stamp = field === 'motd' ? hub?.motdUpdatedAt : hub?.infoUpdatedAt;
    const token = text == null ? null : (stamp ?? null);
    return this.save(actor, guildId, adoptPutBody(field, report.text, token));
  }

  /**
   * ROK-2137 Push (editors): the hub text wins — acknowledge the field's
   * current report so the banner hides until a newer report differs again.
   */
  async push(
    actor: GuildActor,
    guildId: number,
    rawField: string,
  ): Promise<GuildIngameText> {
    const field = parseIngameFieldKey(rawField);
    await this.assertWowGuild(guildId);
    if (!(await acknowledgeGameText(this.db, guildId, field))) {
      throw noReport();
    }
    return this.respond(actor, guildId);
  }

  /** The DTO; editors also get the `game` block (ROK-2137), others never. */
  private async respond(
    actor: GuildActor,
    guildId: number,
  ): Promise<GuildIngameText> {
    const [row, canEdit] = await Promise.all([
      findIngameText(this.db, guildId),
      this.access.canEdit(actor, guildId),
    ]);
    const dto = toIngameTextDto(guildId, row, canEdit);
    if (!canEdit) return dto;
    const hub = { motd: row?.motd ?? null, info: row?.info ?? null };
    const game = toGameTextDto(await findGameText(this.db, guildId), hub);
    return { ...dto, game };
  }

  private async assertWowGuild(guildId: number): Promise<void> {
    if ((await findGuildKind(this.db, guildId)) !== 'wow_guild') {
      throw new NotFoundException('Guild not found');
    }
  }
}

/** Adopt/Push on a field the game never reported. */
function noReport(): ConflictException {
  return new ConflictException({
    message: 'No in-game report for this field yet',
    code: 'NO_GAME_REPORT',
  });
}
