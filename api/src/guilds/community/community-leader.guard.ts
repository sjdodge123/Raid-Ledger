import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
} from '@nestjs/common';
import {
  GuildAccessService,
  ladderCanManageEditors,
  type GuildActor,
} from '../guild-access.service';
import { parseGuildIdParam } from '../guild-editor.guard';

/** The request fields the guard reads. */
export interface LeaderGuardRequest {
  user?: GuildActor;
  params?: Record<string, string | undefined>;
}

/** The one `GuildAccessService` call the guard needs. */
export type LadderResolver = Pick<GuildAccessService, 'resolveLadder'>;

/**
 * ROK-1870 — admits the Leader of a community hub as its hub kind's ladder
 * resolves it (`hub_community_members.role = 'leader'` in an active hub, or
 * staff ⇒ leader). `GuildLeaderGuard` stays staff-only for WoW guilds
 * (`canManageEditors`), so the community routes use this one instead. The
 * services re-check the role; this is the route-level gate. Mount AFTER the
 * JWT auth guard.
 */
@Injectable()
export class CommunityLeaderGuard implements CanActivate {
  constructor(
    @Inject(GuildAccessService) private readonly access: LadderResolver,
  ) {}

  canActivate(context: ExecutionContext): Promise<boolean> {
    return this.check(context.switchToHttp().getRequest<LeaderGuardRequest>());
  }

  /** The gate itself: false unauthenticated, 400 bad id, 403 non-leader. */
  async check(request: LeaderGuardRequest): Promise<boolean> {
    const user = request.user;
    if (!user) return false;
    const guildId = parseGuildIdParam(request.params?.['id']);
    const role = await this.access.resolveLadder(user, guildId);
    if (!ladderCanManageEditors(role)) {
      throw new ForbiddenException('Hub leader access required');
    }
    return true;
  }
}
