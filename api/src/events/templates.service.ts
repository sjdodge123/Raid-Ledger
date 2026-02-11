import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import type {
  CreateTemplateDto,
  TemplateResponseDto,
  TemplateListResponseDto,
} from '@raid-ledger/contract';

@Injectable()
export class TemplatesService {
  private readonly logger = new Logger(TemplatesService.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private db: PostgresJsDatabase<typeof schema>,
  ) {}

  async create(
    userId: number,
    dto: CreateTemplateDto,
  ): Promise<TemplateResponseDto> {
    const [template] = await this.db
      .insert(schema.eventTemplates)
      .values({
        userId,
        name: dto.name,
        config: dto.config,
      })
      .returning();

    this.logger.log(`Template created: ${template.id} by user ${userId}`);
    return this.mapToResponse(template);
  }

  async findAllByUser(userId: number): Promise<TemplateListResponseDto> {
    const templates = await this.db
      .select()
      .from(schema.eventTemplates)
      .where(eq(schema.eventTemplates.userId, userId));

    return { data: templates.map((t) => this.mapToResponse(t)) };
  }

  async delete(id: number, userId: number): Promise<void> {
    const [existing] = await this.db
      .select()
      .from(schema.eventTemplates)
      .where(
        and(
          eq(schema.eventTemplates.id, id),
          eq(schema.eventTemplates.userId, userId),
        ),
      )
      .limit(1);

    if (!existing) {
      throw new NotFoundException(`Template with ID ${id} not found`);
    }

    if (existing.userId !== userId) {
      throw new ForbiddenException('You can only delete your own templates');
    }

    await this.db
      .delete(schema.eventTemplates)
      .where(eq(schema.eventTemplates.id, id));

    this.logger.log(`Template deleted: ${id} by user ${userId}`);
  }

  private mapToResponse(
    template: typeof schema.eventTemplates.$inferSelect,
  ): TemplateResponseDto {
    return {
      id: template.id,
      name: template.name,
      config: template.config as TemplateResponseDto['config'],
      createdAt: template.createdAt.toISOString(),
      updatedAt: template.updatedAt.toISOString(),
    };
  }
}
