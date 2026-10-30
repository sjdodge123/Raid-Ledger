import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { GuildAccessService, type GuildActor } from '../guild-access.service';
import { parseGuildIdParam } from '../guild-editor.guard';

interface RequestWithGuild {
  user?: GuildActor;
  params?: Record<string, string | undefined>;
}

/**
 * ROK-1814 (operator ruling 2026-10-30) — admits callers who may change the
 * crest of the guild named by `:id` (`GuildAccessService.canEditCrest`):
 * every `GuildEditorGuard` caller plus the in-game GM (rank 0). Mount AFTER
 * the JWT auth guard.
 */
@Injectable()
export class HubCrestEditorGuard implements CanActivate {
  constructor(private readonly access: GuildAccessService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithGuild>();
    const user = request.user;
    if (!user) return false;
    const guildId = parseGuildIdParam(request.params?.['id']);
    if (!(await this.access.canEditCrest(user, guildId))) {
      throw new ForbiddenException('Guild editor access required');
    }
    return true;
  }
}
