import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { GuildAccessService, type GuildActor } from './guild-access.service';

interface RequestWithGuild {
  user?: GuildActor;
  params?: Record<string, string | undefined>;
}

/** Parse the `:id` route param; anything but a positive integer is a 400. */
export function parseGuildIdParam(raw: string | undefined): number {
  const id = Number(raw);
  if (!raw || !Number.isInteger(id) || id <= 0) {
    throw new BadRequestException('Invalid guild id');
  }
  return id;
}

/**
 * ROK-1785 D4 — admits callers who may edit the guild named by the `:id`
 * route param (`GuildAccessService.canEdit`). Mount AFTER the JWT auth guard
 * (`@UseGuards(AuthGuard('jwt'), GuildEditorGuard)`), like `OperatorGuard`.
 */
@Injectable()
export class GuildEditorGuard implements CanActivate {
  constructor(private readonly access: GuildAccessService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithGuild>();
    const user = request.user;
    if (!user) return false;
    const guildId = parseGuildIdParam(request.params?.['id']);
    if (!(await this.access.canEdit(user, guildId))) {
      throw new ForbiddenException('Guild editor access required');
    }
    return true;
  }
}
