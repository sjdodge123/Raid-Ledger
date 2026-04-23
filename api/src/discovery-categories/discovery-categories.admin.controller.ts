import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { and, eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type {
  AdminCategoryListResponseDto,
  AdminCategoryPatchDto,
  AdminRejectBodyDto,
  DiscoveryCategorySuggestionDto,
  SuggestionStatus,
  UserRole,
} from '@raid-ledger/contract';
import {
  AdminCategoryPatchSchema,
  AdminRejectBodySchema,
  SuggestionStatusEnum,
} from '@raid-ledger/contract';
import { AdminGuard } from '../auth/admin.guard';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import { SETTING_KEYS } from '../drizzle/schema';
import { LlmService } from '../ai/llm.service';
import { SettingsService } from '../settings/settings.service';
import { DiscoveryCategoriesService } from './discovery-categories.service';

type Db = PostgresJsDatabase<typeof schema>;

interface AuthRequest {
  user: { id: number; role: UserRole };
}

function toDto(
  row: typeof schema.discoveryCategorySuggestions.$inferSelect,
): DiscoveryCategorySuggestionDto {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    categoryType: row.categoryType as DiscoveryCategorySuggestionDto['categoryType'],
    themeVector: row.themeVector,
    filterCriteria:
      (row.filterCriteria as DiscoveryCategorySuggestionDto['filterCriteria']) ??
      {},
    candidateGameIds: row.candidateGameIds,
    status: row.status as SuggestionStatus,
    populationStrategy:
      row.populationStrategy as DiscoveryCategorySuggestionDto['populationStrategy'],
    sortOrder: row.sortOrder,
    expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
    generatedAt: row.generatedAt.toISOString(),
    reviewedBy: row.reviewedBy,
    reviewedAt: row.reviewedAt ? row.reviewedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

@Controller('admin/discovery-categories')
@UseGuards(AuthGuard('jwt'), AdminGuard)
export class DiscoveryCategoriesAdminController {
  constructor(
    @Inject(DrizzleAsyncProvider) private readonly db: Db,
    private readonly service: DiscoveryCategoriesService,
    private readonly llmService: LlmService,
    private readonly settings: SettingsService,
  ) {}

  @Get()
  async list(
    @Query('status') rawStatus?: string,
  ): Promise<AdminCategoryListResponseDto> {
    const status = rawStatus
      ? SuggestionStatusEnum.safeParse(rawStatus)
      : null;
    if (rawStatus && (!status || !status.success)) {
      throw new BadRequestException(
        `Invalid status filter "${rawStatus}" — expected pending|approved|rejected|expired`,
      );
    }
    const rows = status?.success
      ? await this.db
          .select()
          .from(schema.discoveryCategorySuggestions)
          .where(eq(schema.discoveryCategorySuggestions.status, status.data))
          .orderBy(schema.discoveryCategorySuggestions.sortOrder)
      : await this.db
          .select()
          .from(schema.discoveryCategorySuggestions)
          .orderBy(schema.discoveryCategorySuggestions.sortOrder);
    return { suggestions: rows.map(toDto) };
  }

  @Patch(':id')
  async patch(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ): Promise<DiscoveryCategorySuggestionDto> {
    const parsed = AdminCategoryPatchSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.errors[0]?.message ?? 'Invalid patch body');
    }
    const patch = parsed.data as AdminCategoryPatchDto;
    const updates: Partial<typeof schema.discoveryCategorySuggestions.$inferInsert> =
      {};
    if (patch.name !== undefined) updates.name = patch.name;
    if (patch.description !== undefined) updates.description = patch.description;
    if (patch.sortOrder !== undefined) updates.sortOrder = patch.sortOrder;
    if (Object.keys(updates).length === 0) {
      throw new BadRequestException('No supported fields provided');
    }
    const [row] = await this.db
      .update(schema.discoveryCategorySuggestions)
      .set(updates)
      .where(eq(schema.discoveryCategorySuggestions.id, id))
      .returning();
    if (!row) throw new NotFoundException('Suggestion not found');
    return toDto(row);
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  async approve(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: AuthRequest,
  ): Promise<DiscoveryCategorySuggestionDto> {
    return this.reviewPending(id, req.user.id, 'approved');
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  async reject(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Req() req: AuthRequest,
  ): Promise<DiscoveryCategorySuggestionDto> {
    const parsed = AdminRejectBodySchema.safeParse(body ?? {});
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.errors[0]?.message ?? 'Invalid reject body');
    }
    // v1 does not persist reason; the column isn't in the schema yet.
    void (parsed.data as AdminRejectBodyDto);
    return this.reviewPending(id, req.user.id, 'rejected');
  }

  private async reviewPending(
    id: string,
    userId: number,
    nextStatus: 'approved' | 'rejected',
  ): Promise<DiscoveryCategorySuggestionDto> {
    return this.db.transaction(async (tx) => {
      const rows = await tx.execute<{ status: string }>(
        sql`SELECT status FROM ${schema.discoveryCategorySuggestions}
            WHERE id = ${id} FOR UPDATE`,
      );
      const existing = rows[0];
      if (!existing) throw new NotFoundException('Suggestion not found');
      if (existing.status !== 'pending') {
        throw new ConflictException(
          `Suggestion is already ${existing.status}`,
        );
      }
      const [updated] = await tx
        .update(schema.discoveryCategorySuggestions)
        .set({ status: nextStatus, reviewedBy: userId, reviewedAt: new Date() })
        .where(
          and(
            eq(schema.discoveryCategorySuggestions.id, id),
            eq(schema.discoveryCategorySuggestions.status, 'pending'),
          ),
        )
        .returning();
      if (!updated) throw new ConflictException('Suggestion is already reviewed');
      return toDto(updated);
    });
  }

  @Post('regenerate')
  @HttpCode(HttpStatus.ACCEPTED)
  async regenerate(): Promise<{ ok: true }> {
    const flag = await this.settings.get(
      SETTING_KEYS.AI_DYNAMIC_CATEGORIES_ENABLED,
    );
    const available = await this.llmService.isAvailable().catch(() => false);
    if (flag !== 'true' || !available) {
      throw new ServiceUnavailableException(
        'Dynamic discovery categories are disabled',
      );
    }
    await this.service.weeklyGenerate();
    return { ok: true };
  }
}
