import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { GuildAccessService, type GuildActor } from './guild-access.service';
import { parseGuildIdParam } from './guild-editor.guard';

interface RequestWithGuild {
  user?: GuildActor;
  params?: Record<string, string | undefined>;
}

/**
 * ROK-1830 D5-A — admits only the guild's Leader via
 * `GuildAccessService.canManageDiscord`: admin/operator on every kind, plus
 * (ROK-1870 §2.5) a `game_community` hub's ladder Leader — a WoW GM stays
 * refused. Officers hold `canEdit` and are
 * refused here, so the Discord channel binding cannot be rebound by a
 * delegated editor; editor delegation enforces the same rule one layer down,
 * in `GuildEditorsService`. Mount AFTER the JWT auth guard, like
 * `GuildEditorGuard`.
 */
@Injectable()
export class GuildLeaderGuard implements CanActivate {
  constructor(private readonly access: GuildAccessService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithGuild>();
    const user = request.user;
    if (!user) return false;
    const guildId = parseGuildIdParam(request.params?.['id']);
    if (!(await this.access.canManageDiscord(user, guildId))) {
      throw new ForbiddenException('Guild leader access required');
    }
    return true;
  }
}
