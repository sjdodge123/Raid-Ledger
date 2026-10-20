import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
} from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import type * as schema from '../drizzle/schema';
import type { GuildActor } from './guild-access.service';
import { assertNotHidden } from './hub-hidden.helpers';

interface HubRequest {
  params?: Record<string, string | undefined>;
  user?: GuildActor;
}

/**
 * ROK-1831 L-5 — 404 for non-staff on a hidden hub's read routes. Must run
 * AFTER the JWT guard (it reads `req.user`). A route with no numeric `:id`
 * passes through untouched; `ParseIntPipe` owns that answer.
 */
@Injectable()
export class HubVisibleGuard implements CanActivate {
  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<HubRequest>();
    const guildId = Number(req.params?.['id']);
    if (!Number.isInteger(guildId) || req.user === undefined) return true;
    await assertNotHidden(this.db, req.user, guildId);
    return true;
  }
}
