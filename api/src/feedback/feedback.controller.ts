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
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten().fieldErrors);
    }

    const userId = req.user.id;
    const { category, message, pageUrl } = parsed.data;

    // Insert feedback into local DB
    const [inserted] = await this.db
      .insert(schema.feedback)
      .values({
        userId,
        category,
        message,
        pageUrl: pageUrl ?? null,
      })
      .returning();

    this.logger.log(
      `Feedback submitted: id=${inserted.id} category=${category} user=${userId}`,
    );

    // Sentry feedback capture is handled client-side via Sentry.captureFeedback().
    // The local DB save serves as the persistent record.

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
   * GET /feedback
   * List all feedback (admin only, paginated).
   */
  @Get()
  @UseGuards(AuthGuard('jwt'), AdminGuard)
  async listFeedback(
    @Query('page') pageParam?: string,
    @Query('limit') limitParam?: string,
  ): Promise<FeedbackListResponseDto> {
    const page = Math.max(1, parseInt(pageParam ?? '1', 10) || 1);
    const limit = Math.min(
      100,
      Math.max(1, parseInt(limitParam ?? '20', 10) || 20),
    );
    const offset = (page - 1) * limit;

    const [rows, countResult] = await Promise.all([
      this.db
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
        .offset(offset),
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
      meta: {
        total: countResult[0]?.count ?? 0,
        page,
        limit,
      },
    };
  }
}
