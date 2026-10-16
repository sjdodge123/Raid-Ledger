import {
  Body,
  ConflictException,
  Controller,
  DefaultValuePipe,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  ServiceUnavailableException,
  UnprocessableEntityException,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { z } from 'zod';
import {
  UpsertGameRoleSchema,
  type DiscordRoleOptionDto,
  type GameRoleAuditEntryDto,
  type GameRolePreflightDto,
  type GameRoleRunResultDto,
  type GameRoleSummaryDto,
  type UpsertGameRoleDto,
} from '@raid-ledger/contract';
import { AdminGuard } from '../../auth/admin.guard';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { handleValidationError } from '../validation.util';
import {
  createGameRole,
  deleteCreatedRole,
  listAssignableRoles,
  preflightGameRole,
} from './game-role-discord.helpers';
import type { GameRoleDb } from './game-role-reconcile.helpers';
import { GameRoleReconcileService } from './game-role-reconcile.service';
import {
  deleteGameRole,
  findGameName,
  findGameRoleLink,
  findOtherGameUsingRole,
  isRoleLinked,
  listGameRoleAudit,
  listGameRoleSummaries,
  saveGameRole,
} from './game-roles-settings.helpers';

const PreflightBodySchema = z.object({
  roleId: z.string().min(1).max(32).nullable(),
});

function parseOrThrow<T>(schema: z.ZodType<T>, body: unknown): T {
  try {
    return schema.parse(body);
  } catch (error) {
    return handleValidationError(error);
  }
}

const ROLE_TAKEN =
  'That role is already linked to another game. Pick a different role.';
const ROLE_ID_UNIQUE = 'discord_game_roles_role_id_unique';

/**
 * A link racing past the pre-check hits the role_id unique constraint; that
 * one violation is the same 409 the pre-check returns. Anything else is
 * rethrown untouched. Drizzle wraps the driver error on `.cause`.
 */
function rethrowRoleTaken(err: unknown): never {
  const pg = (e: unknown) =>
    e as { code?: string; constraint_name?: string; cause?: unknown } | null;
  for (const e of [pg(err), pg(pg(err)?.cause)]) {
    if (e?.code === '23505' && e.constraint_name === ROLE_ID_UNIQUE) {
      throw new ConflictException(ROLE_TAKEN);
    }
  }
  throw err;
}

function assertPreflight(p: GameRolePreflightDto): void {
  if (!p.ok) {
    throw new UnprocessableEntityException({
      message: 'Game role preflight failed',
      problems: p.problems,
    });
  }
}

/**
 * ROK-1767: admin surface for auto-maintained per-game Discord roles — link
 * a game to a role (or have the bot create one), preflight the hierarchy,
 * unlink, run the reconcile now, and read the audit trail.
 */
@Controller('admin/settings/discord-bot')
@UseGuards(AuthGuard('jwt'), AdminGuard)
export class GameRolesSettingsController {
  constructor(
    @Inject(DrizzleAsyncProvider) private readonly db: GameRoleDb,
    private readonly botClient: DiscordBotClientService,
    private readonly reconcile: GameRoleReconcileService,
  ) {}

  @Get('game-roles')
  list(): Promise<GameRoleSummaryDto[]> {
    return listGameRoleSummaries(this.db, this.botClient.getGuild());
  }

  /** Guild roles for the picker, highest first. */
  @Get('roles')
  roles(): DiscordRoleOptionDto[] {
    return listAssignableRoles(this.botClient.getGuild());
  }

  @Post('game-roles/:gameId/preflight')
  @HttpCode(HttpStatus.OK)
  preflight(
    @Param('gameId', ParseIntPipe) _gameId: number,
    @Body() body: unknown,
  ): Promise<GameRolePreflightDto> {
    const { roleId } = parseOrThrow(PreflightBodySchema, body);
    return preflightGameRole(this.botClient.getGuild(), roleId);
  }

  /** Link (or relink) a game; `roleId: null` creates the role first. 422 on preflight problems. */
  @Put('game-roles/:gameId')
  async upsert(
    @Param('gameId', ParseIntPipe) gameId: number,
    @Body() body: unknown,
  ): Promise<GameRoleSummaryDto> {
    const dto = parseOrThrow(UpsertGameRoleSchema, body);
    const gameName = await findGameName(this.db, gameId);
    if (gameName === null) throw new NotFoundException('Game not found');
    const enabled = dto.enabled ?? true;
    const existing = await findGameRoleLink(this.db, gameId);
    const { roleId, botCreated } = existing
      ? await this.keepRole(existing, dto.roleId, enabled)
      : await this.resolveRole(dto, gameId, gameName);
    const saved = await saveGameRole(this.db, {
      gameId,
      roleId,
      botCreated,
      windowDays: dto.windowDays,
      enabled,
    }).catch(rethrowRoleTaken);
    await this.dropLosingCreatedRole(existing, botCreated, roleId, saved);
    const [summary] = await listGameRoleSummaries(
      this.db,
      this.botClient.getGuild(),
      gameId,
    );
    if (!summary) throw new NotFoundException('Game role not saved');
    return summary;
  }

  /**
   * A concurrent PUT linked the game between our read and our save, and the
   * stored link kept its role. If this request created a role for it, that
   * role is now unused: delete it (best-effort — the helper never throws) —
   * unless ANY game links it, which a delete would break.
   */
  private async dropLosingCreatedRole(
    existing: unknown,
    botCreated: boolean,
    roleId: string,
    saved: { roleId: string },
  ): Promise<void> {
    if (existing || !botCreated || saved.roleId === roleId) return;
    if (await isRoleLinked(this.db, roleId)) return;
    const guild = this.botClient.getGuild();
    if (guild) await deleteCreatedRole(guild, roleId);
  }

  /**
   * Edit of an existing link: the role never changes here (a new role would
   * orphan every member the bot gave the old one). `roleId: null` means "keep
   * the current role". Preflight runs only when the link ends up enabled, so
   * a link whose role broke can still be paused.
   */
  private async keepRole(
    existing: { roleId: string; botCreated: boolean },
    requested: string | null,
    enabled: boolean,
  ): Promise<{ roleId: string; botCreated: boolean }> {
    if (requested !== null && requested !== existing.roleId) {
      throw new ConflictException(
        'This game is already linked to another role. Unlink it first.',
      );
    }
    if (enabled) {
      const guild = this.botClient.getGuild();
      assertPreflight(await preflightGameRole(guild, null));
      assertPreflight(await preflightGameRole(guild, existing.roleId));
    }
    return existing;
  }

  private async resolveRole(
    dto: UpsertGameRoleDto,
    gameId: number,
    gameName: string,
  ): Promise<{ roleId: string; botCreated: boolean }> {
    const guild = this.botClient.getGuild();
    assertPreflight(await preflightGameRole(guild, null));
    if (dto.roleId !== null) {
      // Reconcile runs per game: a shared role would have one game remove
      // members another game still wants.
      if (
        (await findOtherGameUsingRole(this.db, dto.roleId, gameId)) !== null
      ) {
        throw new ConflictException(ROLE_TAKEN);
      }
      assertPreflight(await preflightGameRole(guild, dto.roleId));
      return { roleId: dto.roleId, botCreated: false };
    }
    if (!guild) throw new ServiceUnavailableException('Bot is not connected');
    const created = await createGameRole(guild, dto.name ?? gameName);
    const check = await preflightGameRole(guild, created.id);
    if (!check.ok) await deleteCreatedRole(guild, created.id);
    assertPreflight(check);
    return { roleId: created.id, botCreated: true };
  }

  /** Stop managing the game. Roles already on members stay (spec D2). */
  @Delete('game-roles/:gameId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('gameId', ParseIntPipe) gameId: number): Promise<void> {
    if (!(await deleteGameRole(this.db, gameId))) {
      throw new NotFoundException('Game is not linked to a role');
    }
  }

  @Post('game-roles/run')
  @HttpCode(HttpStatus.OK)
  async run(
    @Query('gameId', new DefaultValuePipe(0), ParseIntPipe) gameId: number,
  ): Promise<GameRoleRunResultDto> {
    const result = await this.reconcile.runReconciliation(
      gameId > 0 ? { gameId } : {},
    );
    if (result === false) {
      throw new ServiceUnavailableException('Discord bot is not connected');
    }
    return result;
  }

  @Get('game-roles/:gameId/audit')
  audit(
    @Param('gameId', ParseIntPipe) gameId: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ): Promise<GameRoleAuditEntryDto[]> {
    return listGameRoleAudit(
      this.db,
      gameId,
      Math.min(Math.max(limit, 1), 100),
    );
  }
}
