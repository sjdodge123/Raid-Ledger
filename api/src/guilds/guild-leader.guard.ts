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
 * ROK-1830 D5-A — admits only the guild's Leader (today: admin/operator) via
 * `GuildAccessService.canManageEditors`. Officers hold `canEdit` and are
 * refused here, so the Leader-only switches (the Discord channel binding,
 * editor delegation) cannot be reached by a delegated editor. Mount AFTER the
 * JWT auth guard, like `GuildEditorGuard`.
 */
@Injectable()
export class GuildLeaderGuard implements CanActivate {
  constructor(private readonly access: GuildAccessService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithGuild>();
    const user = request.user;
    if (!user) return false;
    const guildId = parseGuildIdParam(request.params?.['id']);
    if (!(await this.access.canManageEditors(user, guildId))) {
      throw new ForbiddenException('Guild leader access required');
    }
    return true;
  }
}
