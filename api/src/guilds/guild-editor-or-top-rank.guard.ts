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
 * ROK-2192 (operator ruling 2026-11-13) — admits every `GuildEditorGuard`
 * caller plus the in-game GM (rank 0) of the guild named by `:id`
 * (`GuildAccessService.canEditOrHoldsTopRank`, the ROK-1789 Q-A6 recruitment
 * rule). For the hub-settings writes a GM may make only. Mount AFTER the JWT
 * auth guard.
 */
@Injectable()
export class GuildEditorOrTopRankGuard implements CanActivate {
  constructor(private readonly access: GuildAccessService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithGuild>();
    const user = request.user;
    if (!user) return false;
    const guildId = parseGuildIdParam(request.params?.['id']);
    if (!(await this.access.canEditOrHoldsTopRank(user, guildId))) {
      throw new ForbiddenException('Guild editor access required');
    }
    return true;
  }
}
