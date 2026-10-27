import {
  BadRequestException,
  Inject,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import Redis from 'ioredis';
import type { AuthenticatedExpressRequest } from '../auth/types';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import type * as schema from '../drizzle/schema';
import { GuildAccessService } from '../guilds/guild-access.service';
import { REDIS_CLIENT } from '../redis/redis.module';
import { checkUploadRate } from './hub-media-upload.limits';
import { assertCanViewHubMedia } from './hub-media.access';

/**
 * ROK-1965 §4.3 steps 4–5 — everything that can refuse an upload without
 * its bytes runs here, because Nest runs guards BEFORE interceptors: multer
 * never buffers a body for a malformed id (400, the `HubMediaIdPipe`
 * message), a non-member / hidden / missing hub (404, D2) or a user past
 * the hourly window (429, D8 — counted before the encode, so a rejected
 * file still costs a slot).
 */
@Injectable()
export class HubMediaUploadGuard implements CanActivate {
  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly access: GuildAccessService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthenticatedExpressRequest>();
    const guildId = Number(req.params.guildId);
    if (!Number.isSafeInteger(guildId) || guildId <= 0) {
      throw new BadRequestException('Invalid id');
    }
    await assertCanViewHubMedia(this.db, this.access, req.user, guildId);
    await checkUploadRate(this.redis, req.user.id);
    return true;
  }
}
