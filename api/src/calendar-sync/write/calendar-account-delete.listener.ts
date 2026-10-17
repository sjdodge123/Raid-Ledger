/**
 * ROK-1596 D12 (Q11 Lead default): best-effort calendar cleanup before an
 * account is deleted. `UsersService.deleteUser` awaits
 * `emitAsync('user.deleting', {userId})` before its cascade; the stored
 * credentials die with that cascade, so a queued job could never run.
 *
 * Marks every connection of the user `disconnecting`, then runs the
 * disconnect job body inline for each (copies, dedicated calendar, revoke,
 * row) under ONE total budget. Every error is swallowed and a slow provider
 * is abandoned at the budget: the account delete must never fail or hang
 * because Google did. Decoupled by event so UsersModule does not import
 * CalendarSyncModule.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import { CalendarProviderRegistry } from '../providers/calendar-provider.registry';
import {
  type CalendarDisconnectDeps,
  runCalendarDisconnect,
} from '../services/calendar-disconnect.helpers';

/** Emitted (and awaited) by `UsersService.deleteUser`. */
export const USER_DELETING_EVENT = 'user.deleting';
export const ACCOUNT_DELETE_BUDGET_MS = 10_000;

export type AccountCleanupOutcome = 'done' | 'timeout' | 'failed';

const logger = new Logger('CalendarAccountDelete');

async function disconnectAll(
  deps: CalendarDisconnectDeps,
  userId: number,
): Promise<void> {
  const t = schema.calendarConnections;
  const rows = await deps.db
    .update(t)
    .set({ status: 'disconnecting', updatedAt: new Date() })
    .where(eq(t.userId, userId))
    .returning({ id: t.id });
  for (const { id } of rows) {
    try {
      await runCalendarDisconnect(deps, id);
    } catch (err) {
      const code = err instanceof Error ? err.name : 'unknown';
      logger.warn(`calendar cleanup failed for connection ${id} (${code})`);
    }
  }
}

/** Run the cleanup for `userId`; resolves within `budgetMs`, never rejects. */
export async function cleanupCalendarsForUser(
  deps: CalendarDisconnectDeps,
  userId: number,
  budgetMs = ACCOUNT_DELETE_BUDGET_MS,
): Promise<AccountCleanupOutcome> {
  const work = disconnectAll(deps, userId).then(
    () => 'done' as const,
    () => 'failed' as const,
  );
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), budgetMs);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

@Injectable()
export class CalendarAccountDeleteListener {
  /** Mutable so a spec can shorten it; production keeps the default. */
  budgetMs = ACCOUNT_DELETE_BUDGET_MS;

  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly registry: CalendarProviderRegistry,
  ) {}

  @OnEvent(USER_DELETING_EVENT)
  async onUserDeleting(payload: { userId: number }): Promise<void> {
    const deps = { db: this.db, registry: this.registry };
    const outcome = await cleanupCalendarsForUser(
      deps,
      payload.userId,
      this.budgetMs,
    );
    if (outcome !== 'done') {
      logger.warn(`calendar cleanup for user ${payload.userId}: ${outcome}`);
    }
  }
}
