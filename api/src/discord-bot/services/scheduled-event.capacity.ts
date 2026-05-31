import type { Logger } from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import type { DiscordBotClientService } from '../discord-bot-client.service';
import { isAtScheduledEventCapacityError } from './scheduled-event.discord-ops';
import { gcStaleRLScheduledEvents } from './scheduled-event.gc';
import { CapacityStillSaturatedError } from './scheduled-event.helpers';

type Guild = NonNullable<ReturnType<DiscordBotClientService['getGuild']>>;

/**
 * ROK-1332: Catch Discord 30038 ("guild at 100-SE cap"), sweep stale
 * RL-tracked SEs, retry the call once. If GC freed 0 rows, throw
 * CapacityStillSaturatedError so the reconciliation cron can apply
 * per-event backoff and emit a single WARN per tick.
 *
 * Lives as a free function (not a method on ScheduledEventService) so the
 * service file stays under the 300-line cap; the wrapper itself is pure
 * coordination + has no service-instance dependencies beyond what's passed in.
 */
export async function withCapacityRecovery(
  guild: Guild,
  db: PostgresJsDatabase<typeof schema>,
  logger: Logger,
  fn: () => Promise<void>,
): Promise<void> {
  try {
    await fn();
  } catch (err) {
    if (!isAtScheduledEventCapacityError(err)) throw err;
    const { freed, orphanCount } = await gcStaleRLScheduledEvents(guild, db);
    logger.log(
      `Discord SE capacity GC freed=${freed} orphanCount=${orphanCount}`,
    );
    if (freed === 0) throw new CapacityStillSaturatedError(orphanCount);
    await fn();
  }
}
