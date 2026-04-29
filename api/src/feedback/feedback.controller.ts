import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  UseGuards,
  Req,
  HttpCode,
  HttpStatus,
  Logger,
  Inject,
  BadRequestException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import * as Sentry from '@sentry/nestjs';
import { AdminGuard } from '../auth/admin.guard';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { RateLimit } from '../throttler/rate-limit.decorator';
import {
  CreateFeedbackSchema,
  type FeedbackResponseDto,
  type FeedbackListResponseDto,
  type UserRole,
} from '@raid-ledger/contract';
import { eq, desc, sql } from 'drizzle-orm';
import * as schema from '../drizzle/schema';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { SlowQueriesService } from '../slow-queries/slow-queries.service';

interface AuthRequest extends Request {
  user: { id: number; role: UserRole };
}

/**
 * Feedback controller — handles user-submitted feedback.
 * ROK-186: User Feedback Widget + GitHub Issues integration.
 */
@Controller('feedback')
export class FeedbackController {
  private readonly logger = new Logger(FeedbackController.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: NodePgDatabase<typeof schema>,
    private readonly slowQueries: SlowQueriesService,
  ) {}

  /**
   * POST /feedback
   * Submit feedback (authenticated users only).
   * Saves to local DB and creates a GitHub issue if configured.
   */
  @Post()
  @UseGuards(AuthGuard('jwt'))
  @RateLimit('auth')
  @HttpCode(HttpStatus.CREATED)
  async submitFeedback(
    @Body() body: unknown,
    @Req() req: AuthRequest,
  ): Promise<FeedbackResponseDto> {
    const parsed = CreateFeedbackSchema.safeParse(body);
    if (!parsed.success)
      throw new BadRequestException(parsed.error.flatten().fieldErrors);
    const userId = req.user.id;
    const { category, message, pageUrl, clientLogs } = parsed.data;
    const [inserted] = await this.db
      .insert(schema.feedback)
      .values({ userId, category, message, pageUrl: pageUrl ?? null })
      .returning();
    this.logger.log(
      `Feedback submitted: id=${inserted.id} category=${category} user=${userId}`,
    );
    await this.attachSlowQueryContext(inserted.id, req.user.role, clientLogs);
    return {
      id: inserted.id,
      category: inserted.category as FeedbackResponseDto['category'],
      message: inserted.message,
      pageUrl: inserted.pageUrl,
      githubIssueUrl: null,
      createdAt: inserted.createdAt.toISOString(),
    };
  }

  /**
   * ROK-1156: when an admin submits feedback with the "Capture and send
   * client logs" checkbox on, attach the tail of `slow-queries.log` as a
   * separate Sentry event tagged with the same feedback_id. Operators
   * triaging in Sentry then see the slow-query context next to the bug
   * report. No-op for non-admins or when the checkbox is off.
   */
  private async attachSlowQueryContext(
    feedbackId: number,
    role: UserRole,
    clientLogs: string | undefined,
  ): Promise<void> {
    if (role !== 'admin' || !clientLogs) return;
    try {
      const tail = await this.slowQueries.readLogTail();
      if (!tail) return;
      Sentry.captureMessage(`[Feedback ${feedbackId}] Slow query context`, {
        level: 'info',
        tags: { feedback_id: String(feedbackId), source: 'slow_query_attach' },
        extra: { slowQueryLogTail: tail },
      });
    } catch (err) {
      this.logger.warn(
        `Failed to attach slow-query context for feedback ${feedbackId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /** Parse and clamp pagination params. */
  private parsePagination(pageParam?: string, limitParam?: string) {
    const page = Math.max(1, parseInt(pageParam ?? '1', 10) || 1);
    const limit = Math.min(
      100,
      Math.max(1, parseInt(limitParam ?? '20', 10) || 20),
    );
    return { page, limit, offset: (page - 1) * limit };
  }

  /** Query feedback rows with user join. */
  private async queryFeedbackRows(limit: number, offset: number) {
    return this.db
      .select({
        id: schema.feedback.id,
        userId: schema.feedback.userId,
        category: schema.feedback.category,
        message: schema.feedback.message,
        pageUrl: schema.feedback.pageUrl,
        githubIssueUrl: schema.feedback.githubIssueUrl,
        createdAt: schema.feedback.createdAt,
        username: schema.users.username,
      })
      .from(schema.feedback)
      .innerJoin(schema.users, eq(schema.feedback.userId, schema.users.id))
      .orderBy(desc(schema.feedback.createdAt))
      .limit(limit)
      .offset(offset);
  }

  /**
   * GET /feedback
   * List all feedback (admin only, paginated).
   */
  @Get()
  @UseGuards(AuthGuard('jwt'), AdminGuard)
  async listFeedback(
    @Query('page') pageParam?: string,
    @Query('limit') limitParam?: string,
  ): Promise<FeedbackListResponseDto> {
    const { page, limit, offset } = this.parsePagination(pageParam, limitParam);
    const [rows, countResult] = await Promise.all([
      this.queryFeedbackRows(limit, offset),
      this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.feedback),
    ]);
    return {
      data: rows.map((row) => ({
        id: row.id,
        userId: row.userId,
        username: row.username,
        category:
          row.category as FeedbackListResponseDto['data'][0]['category'],
        message: row.message,
        pageUrl: row.pageUrl,
        githubIssueUrl: row.githubIssueUrl,
        createdAt: row.createdAt.toISOString(),
      })),
      meta: { total: countResult[0]?.count ?? 0, page, limit },
    };
  }
}
