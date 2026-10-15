/**
 * ROK-1313: POST /feedback persistence, split out of the controller so each
 * step stays small. Order matters: the screenshot is validated BEFORE the
 * insert (a 400/413 leaves no row and no file), and a failed file write never
 * loses the report text.
 */
import {
  BadRequestException,
  PayloadTooLargeException,
  type Logger,
} from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import {
  CreateFeedbackSchema,
  FEEDBACK_SCREENSHOT_MAX_BASE64_CHARS,
  type CreateFeedbackDto,
  type FeedbackResponseDto,
} from '@raid-ledger/contract';
import * as schema from '../drizzle/schema';
import { defined } from '../common/defined.helpers';
import {
  type ScreenshotExt,
  validateScreenshot,
  writeScreenshot,
} from './feedback-screenshot.helpers';

type Db = NodePgDatabase<typeof schema>;
type FeedbackRow = typeof schema.feedback.$inferSelect;

export interface ValidatedScreenshot {
  buf: Buffer;
  ext: ScreenshotExt;
}

const CLIENT_LOGS_MAX_CHARS = 50_000;

/**
 * Parse the body. An over-cap screenshot is a 413 BEFORE zod runs, so the
 * caller sees "too large" rather than zod's generic `max` 400.
 */
export function parseFeedbackBody(body: unknown): CreateFeedbackDto {
  if (typeof body === 'object' && body !== null) {
    const shot: unknown = Reflect.get(body, 'screenshotBase64');
    if (
      typeof shot === 'string' &&
      shot.length > FEEDBACK_SCREENSHOT_MAX_BASE64_CHARS
    ) {
      throw new PayloadTooLargeException('Screenshot is too large');
    }
  }
  const parsed = CreateFeedbackSchema.safeParse(body);
  if (!parsed.success) {
    throw new BadRequestException(parsed.error.flatten().fieldErrors);
  }
  return parsed.data;
}

/** Validate the optional screenshot; throws 400/413 before anything is written. */
export function prepareScreenshot(
  dto: CreateFeedbackDto,
): ValidatedScreenshot | null {
  return dto.screenshotBase64 ? validateScreenshot(dto.screenshotBase64) : null;
}

/** Insert the feedback row (screenshot path is set afterwards). */
export async function insertFeedbackRow(
  db: Db,
  userId: number,
  dto: CreateFeedbackDto,
): Promise<FeedbackRow> {
  const [row] = await db
    .insert(schema.feedback)
    .values({
      userId,
      category: dto.category,
      message: dto.message,
      pageUrl: dto.pageUrl ?? null,
      clientLogs: dto.clientLogs
        ? dto.clientLogs.slice(0, CLIENT_LOGS_MAX_CHARS)
        : null,
      clientContext: dto.clientContext ?? null,
    })
    .returning();
  return defined(row, 'inserted feedback row');
}

/**
 * Write the screenshot file and record its path. Failure is logged and sent
 * to Sentry but never thrown: the report itself is already saved.
 */
export async function storeScreenshot(
  db: Db,
  feedbackId: number,
  shot: ValidatedScreenshot,
  logger: Logger,
): Promise<void> {
  try {
    const relPath = await writeScreenshot(feedbackId, shot.buf, shot.ext);
    await db
      .update(schema.feedback)
      .set({ screenshotPath: relPath })
      .where(eq(schema.feedback.id, feedbackId));
  } catch (err) {
    const code = err instanceof Error ? err.name : 'unknown';
    logger.warn(
      `Failed to store screenshot for feedback ${feedbackId} (${code})`,
    );
    Sentry.captureException(err, {
      tags: { feedback_id: String(feedbackId), source: 'feedback_screenshot' },
    });
  }
}

/** Map an inserted row to the POST /feedback response. */
export function toFeedbackResponse(row: FeedbackRow): FeedbackResponseDto {
  return {
    id: row.id,
    category: row.category as FeedbackResponseDto['category'],
    message: row.message,
    pageUrl: row.pageUrl,
    githubIssueUrl: null,
    createdAt: row.createdAt.toISOString(),
  };
}
