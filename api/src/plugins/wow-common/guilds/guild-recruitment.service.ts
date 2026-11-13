import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  PutGuildRecruitmentSchema,
  type GuildRecruitment,
  type GuildRecruitmentView,
} from '@raid-ledger/contract';
import { DrizzleAsyncProvider } from '../../../drizzle/drizzle.module';
import {
  GuildAccessService,
  type GuildActor,
} from '../../../guilds/guild-access.service';
import { findGuildKind } from '../../../guilds/guild-core.queries';
import {
  normaliseRecruitment,
  toRecruitmentView,
} from './guild-recruitment.helpers';
import {
  findRecruitmentRow,
  upsertRecruitment,
  type Db,
} from './guild-recruitment.queries';

const NOT_MEMBER = 'Not a member of this guild';
const NOT_EDITOR =
  'Only guild editors or the Guild Master can change recruitment';

/**
 * ROK-1789 (S5 part A) — a WoW guild's recruitment. Read = `canView`
 * (members + staff; 403 before 404). Write (PUT / DELETE) and
 * `viewer.canEdit` = `canEdit` OR the in-game top rank (ruling A1; A-D5),
 * checked here rather than with `GuildEditorGuard`. Only `wow_guild` hubs.
 */
@Injectable()
export class GuildRecruitmentService {
  constructor(
    @Inject(DrizzleAsyncProvider) private readonly db: Db,
    private readonly access: GuildAccessService,
  ) {}

  /** The current recruitment view (all-null when unset). */
  async get(actor: GuildActor, guildId: number): Promise<GuildRecruitmentView> {
    await this.assertCanView(actor, guildId);
    await this.assertWowGuild(guildId);
    return this.respond(guildId, await this.canEditRecruitment(actor, guildId));
  }

  /** Replace the whole recruitment object (last write wins, A-D4). */
  async put(
    actor: GuildActor,
    guildId: number,
    body: unknown,
  ): Promise<GuildRecruitmentView> {
    await this.assertCanWrite(actor, guildId);
    const value = parseRecruitmentPut(body);
    await upsertRecruitment(this.db, guildId, value, actor.id, new Date());
    return this.respond(guildId, true);
  }

  /** Clear back to unset (the three columns NULL). */
  async remove(actor: GuildActor, guildId: number): Promise<void> {
    await this.assertCanWrite(actor, guildId);
    await upsertRecruitment(this.db, guildId, null, actor.id, new Date());
  }

  /** Editor grant / staff (`canEdit`), or the GUID-linked rank-0 GM (A1). */
  private async canEditRecruitment(
    actor: GuildActor,
    guildId: number,
  ): Promise<boolean> {
    if (await this.access.canEdit(actor, guildId)) return true;
    return this.access.holdsTopRank(actor, guildId);
  }

  private async assertCanWrite(
    actor: GuildActor,
    guildId: number,
  ): Promise<void> {
    await this.assertCanView(actor, guildId);
    if (!(await this.canEditRecruitment(actor, guildId))) {
      throw new ForbiddenException(NOT_EDITOR);
    }
    await this.assertWowGuild(guildId);
  }

  private async assertCanView(
    actor: GuildActor,
    guildId: number,
  ): Promise<void> {
    if (!(await this.access.canView(actor, guildId))) {
      throw new ForbiddenException(NOT_MEMBER);
    }
  }

  private async assertWowGuild(guildId: number): Promise<void> {
    if ((await findGuildKind(this.db, guildId)) !== 'wow_guild') {
      throw new NotFoundException('Guild not found');
    }
  }

  private async respond(
    guildId: number,
    canEdit: boolean,
  ): Promise<GuildRecruitmentView> {
    const row = await findRecruitmentRow(this.db, guildId);
    return toRecruitmentView(row, canEdit);
  }
}

/** Contract-validate a PUT body (400 with `fieldErrors`), then normalise. */
function parseRecruitmentPut(body: unknown): GuildRecruitment {
  const parsed = PutGuildRecruitmentSchema.safeParse(body);
  if (!parsed.success) {
    throw new BadRequestException({
      message: 'Invalid recruitment',
      errors: parsed.error.flatten().fieldErrors,
    });
  }
  return normaliseRecruitment(parsed.data);
}
