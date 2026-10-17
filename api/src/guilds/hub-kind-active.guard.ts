import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
} from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import type * as schema from '../drizzle/schema';
import { findGuildKind } from './guild-core.queries';
import { HubKindRegistry } from './hub-kind.registry';

/**
 * ROK-1830 S2b — the core replacement for `@RequirePlugin(<game manifest>)` on
 * a hub route: the guild's own `kind` names the owning plugin, so core no
 * longer imports a game plugin's manifest. `HubKindRegistry.require` throws
 * `PluginActiveGuard`'s exact 403 while that plugin is inactive, and a 404
 * when no plugin claims the kind.
 *
 * A route whose `:id` is absent, non-numeric or names no guild passes through
 * untouched — `ParseIntPipe` and the handler already own those answers.
 */
@Injectable()
export class HubKindActiveGuard implements CanActivate {
  constructor(
    private readonly hubKinds: HubKindRegistry,
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context
      .switchToHttp()
      .getRequest<{ params?: Record<string, string | undefined> }>();
    const raw = req.params?.['id'];
    if (raw === undefined) return true;
    const guildId = Number(raw);
    if (!Number.isInteger(guildId)) return true;
    const kind = await findGuildKind(this.db, guildId);
    if (kind === null) return true;
    this.hubKinds.require(kind);
    return true;
  }
}
