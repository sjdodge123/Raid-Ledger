/**
 * ROK-1313: remove a user's feedback screenshot files before their account is
 * deleted. `UsersService.deleteUser` awaits `user.deleting` before the cascade
 * that drops the feedback rows — after it the paths would be unknowable and
 * the files orphaned on disk. Best-effort: never throws, so a disk error can
 * never fail the account delete.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { and, eq, isNotNull } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../drizzle/schema';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { USER_DELETING_EVENT } from '../calendar-sync/write/calendar-account-delete.listener';
import { deleteScreenshotFiles } from './feedback-screenshot.helpers';

@Injectable()
export class FeedbackScreenshotCleanupListener {
  private readonly logger = new Logger(FeedbackScreenshotCleanupListener.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: NodePgDatabase<typeof schema>,
  ) {}

  @OnEvent(USER_DELETING_EVENT)
  async onUserDeleting(payload: { userId: number }): Promise<void> {
    try {
      const paths = await this.selectPaths(payload.userId);
      const refused = await deleteScreenshotFiles(paths);
      if (refused.length > 0) {
        this.logger.warn(
          `user ${payload.userId}: refused ${refused.length} screenshot path(s) outside the feedback dir`,
        );
      }
    } catch (err) {
      const code = err instanceof Error ? err.name : 'unknown';
      this.logger.warn(
        `screenshot cleanup for user ${payload.userId} failed (${code})`,
      );
    }
  }

  private async selectPaths(userId: number): Promise<string[]> {
    const t = schema.feedback;
    const rows = await this.db
      .select({ path: t.screenshotPath })
      .from(t)
      .where(and(eq(t.userId, userId), isNotNull(t.screenshotPath)));
    return rows.flatMap((r) => (r.path ? [r.path] : []));
  }
}
