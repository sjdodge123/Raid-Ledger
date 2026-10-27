import {
  Inject,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { AuthenticatedExpressRequest } from '../auth/types';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import type * as schema from '../drizzle/schema';
import { GuildAccessService } from '../guilds/guild-access.service';
import { assertCanViewHubMedia } from './hub-media.access';

/**
 * ROK-1965 §4.3 step 4 — the D2 "who may upload" gate (= who may view the
 * Gallery, else the hub 404). A guard, because Nest runs guards BEFORE
 * interceptors: a non-member's body is never read by multer. A malformed
 * id passes through so `HubMediaIdPipe` answers its 400.
 */
@Injectable()
export class HubMediaUploadGuard implements CanActivate {
  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly access: GuildAccessService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthenticatedExpressRequest>();
    const guildId = Number(req.params.guildId);
    if (!Number.isInteger(guildId) || guildId <= 0) return true;
    await assertCanViewHubMedia(this.db, this.access, req.user, guildId);
    return true;
  }
}
