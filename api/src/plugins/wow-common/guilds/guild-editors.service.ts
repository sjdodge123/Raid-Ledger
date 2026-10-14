import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import {
  CreateGuildEditorSchema,
  type CreateGuildEditorInput,
  type GuildEditor,
  type GuildEditorList,
} from '@raid-ledger/contract';
import { DrizzleAsyncProvider } from '../../../drizzle/drizzle.module';
import * as schema from '../../../drizzle/schema';
import { GuildAccessService, type GuildActor } from './guild-access.service';
import {
  deleteGrant,
  findDuplicateGrant,
  insertGrant,
  isLiveMemberOf,
  isUniqueViolation,
  loadEditorRows,
  toGuildEditor,
} from './guild-editors.helpers';
import { findGuild, rankNamesInSnapshot } from './guild-queries.helpers';

/**
 * ROK-1785 — the Editors panel: list / grant / revoke delegated editors.
 * Only `canManageEditors` (admin, operator) reaches any of it (spec §3).
 */
@Injectable()
export class GuildEditorsService {
  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly access: GuildAccessService,
  ) {}

  async list(actor: GuildActor, guildId: number): Promise<GuildEditorList> {
    await this.assertManager(actor, guildId);
    return { editors: await this.loadEditors(guildId) };
  }

  /** Grant a rank or a member row; 409 on a duplicate target. */
  async create(
    actor: GuildActor,
    guildId: number,
    body: unknown,
  ): Promise<GuildEditor> {
    const input = parseCreate(body);
    await this.assertManager(actor, guildId);
    await this.assertTarget(guildId, input);
    if (await findDuplicateGrant(this.db, guildId, input)) {
      throw new ConflictException('This editor is already granted');
    }
    const id = await this.insert(guildId, input, actor.id);
    const created = (await this.loadEditors(guildId)).find((e) => e.id === id);
    if (!created) throw new NotFoundException('Editor not found');
    return created;
  }

  async remove(
    actor: GuildActor,
    guildId: number,
    editorId: number,
  ): Promise<void> {
    await this.assertManager(actor, guildId);
    if (!(await deleteGrant(this.db, guildId, editorId))) {
      throw new NotFoundException('Editor not found');
    }
  }

  private async assertManager(
    actor: GuildActor,
    guildId: number,
  ): Promise<void> {
    if (!(await this.access.canManageEditors(actor, guildId))) {
      throw new ForbiddenException('Only the guild master can manage editors');
    }
    if (!(await findGuild(this.db, guildId))) {
      throw new NotFoundException('Guild not found');
    }
  }

  private async assertTarget(
    guildId: number,
    input: CreateGuildEditorInput,
  ): Promise<void> {
    if (input.kind !== 'member') return;
    if (!(await isLiveMemberOf(this.db, guildId, input.guildMemberId))) {
      throw new BadRequestException('Member is not in this guild');
    }
  }

  /** Insert; a concurrent duplicate surfaces as a unique violation → 409. */
  private async insert(
    guildId: number,
    input: CreateGuildEditorInput,
    grantedBy: number,
  ): Promise<number> {
    try {
      return await insertGrant(this.db, guildId, input, grantedBy);
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException('This editor is already granted');
      }
      throw err;
    }
  }

  private async loadEditors(guildId: number): Promise<GuildEditor[]> {
    const [rows, rankNames] = await Promise.all([
      loadEditorRows(this.db, guildId),
      rankNamesInSnapshot(this.db, guildId),
    ]);
    return rows.map((r) => toGuildEditor(r, rankNames));
  }
}

function parseCreate(body: unknown): CreateGuildEditorInput {
  const parsed = CreateGuildEditorSchema.safeParse(body);
  if (!parsed.success) {
    throw new BadRequestException(parsed.error.flatten().fieldErrors);
  }
  return parsed.data;
}
