/**
 * ROK-1313: remove a user's feedback screenshot files before their account is
 * deleted. `UsersService.deleteUser` awaits `user.deleting` before the cascade
 * that drops the feedback rows — after it the paths would be unknowable and
 * the files orphaned on disk. Best-effort: never throws, so a disk error can
 * never fail the account delete. (Ban + wipe has no `user.deleting`; it calls
 * the same helpers from `users-moderation-orchestration.helpers`.)
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { USER_DELETING_EVENT } from '../calendar-sync/write/calendar-account-delete.listener';
import {
  deleteUserScreenshotsBestEffort,
  selectUserScreenshotPaths,
} from './feedback-screenshot-user.helpers';

@Injectable()
export class FeedbackScreenshotCleanupListener {
  private readonly logger = new Logger(FeedbackScreenshotCleanupListener.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  @OnEvent(USER_DELETING_EVENT)
  async onUserDeleting(payload: { userId: number }): Promise<void> {
    let paths: string[];
    try {
      paths = await selectUserScreenshotPaths(this.db, payload.userId);
    } catch (err) {
      const code = err instanceof Error ? err.name : 'unknown';
      this.logger.warn(
        `screenshot cleanup for user ${payload.userId} failed (${code})`,
      );
      return;
    }
    await deleteUserScreenshotsBestEffort(paths, payload.userId, this.logger);
  }
}
