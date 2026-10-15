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
  CreateGuildAddonSchema,
  GUILD_ADDONS_MAX,
  ReorderGuildAddonsSchema,
  UpdateGuildAddonSchema,
  type CreateGuildAddonInput,
  type GuildAddon,
  type GuildAddonList,
} from '@raid-ledger/contract';
import type { ZodType } from 'zod';
import { DrizzleAsyncProvider } from '../../../drizzle/drizzle.module';
import * as schema from '../../../drizzle/schema';
import { SettingsService } from '../../../settings/settings.service';
import { GuildAccessService, type GuildActor } from './guild-access.service';
import {
  parseAddonLink,
  type ParsedAddonLink,
} from './guild-addon-url.helpers';
import {
  addonStats,
  blankToNull,
  buildAddonUpdate,
  deleteAddonRow,
  findAddonRow,
  hasAddonCollision,
  insertAddon,
  isSameIdSet,
  listAddonRows,
  toGuildAddon,
  updateAddonRow,
  writeAddonOrder,
} from './guild-addons.helpers';
import { isUniqueViolation } from './guild-editors.helpers';
import { readPinnedAddons } from './guild-pinned-addons.helpers';
import { findGuild } from './guild-queries.helpers';

const DUPLICATE = 'This addon is already on the guild list';

/**
 * ROK-1786 — the guild's recommended addons (+ community pinned ones).
 * Reads need `canView`; writes arrive behind `GuildEditorGuard`. Every write
 * is scoped by guild id, so another guild's addon id is a 404.
 */
@Injectable()
export class GuildAddonsService {
  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly access: GuildAccessService,
    private readonly settings: SettingsService,
  ) {}

  async list(actor: GuildActor, guildId: number): Promise<GuildAddonList> {
    if (!(await this.access.canView(actor, guildId))) {
      throw new ForbiddenException('Not a member of this guild');
    }
    await this.assertGuild(guildId);
    return this.load(guildId);
  }

  async create(
    actor: GuildActor,
    guildId: number,
    body: unknown,
  ): Promise<GuildAddon> {
    const input = parse(CreateGuildAddonSchema, body);
    const link = toLink(input.url);
    await this.assertGuild(guildId);
    const { count, nextSort } = await addonStats(this.db, guildId);
    if (count >= GUILD_ADDONS_MAX) {
      throw new BadRequestException(`At most ${GUILD_ADDONS_MAX} addons`);
    }
    await this.assertNoCollision(guildId, link);
    const row = await this.guardUnique(() =>
      insertAddon(this.db, newRow(guildId, input, link, actor.id, nextSort)),
    );
    if (!row) throw new NotFoundException('Addon not found');
    return toGuildAddon(row);
  }

  async update(
    actor: GuildActor,
    guildId: number,
    addonId: number,
    body: unknown,
  ): Promise<GuildAddon> {
    const input = parse(UpdateGuildAddonSchema, body);
    const link = input.url === undefined ? null : toLink(input.url);
    if (!(await findAddonRow(this.db, guildId, addonId))) {
      throw new NotFoundException('Addon not found');
    }
    if (link) await this.assertNoCollision(guildId, link, addonId);
    const set = buildAddonUpdate(input, link, actor.id, new Date());
    const row = await this.guardUnique(() =>
      updateAddonRow(this.db, guildId, addonId, set),
    );
    if (!row) throw new NotFoundException('Addon not found');
    return toGuildAddon(row);
  }

  async remove(guildId: number, addonId: number): Promise<void> {
    if (!(await deleteAddonRow(this.db, guildId, addonId))) {
      throw new NotFoundException('Addon not found');
    }
  }

  /** `ids` must be exactly the guild's own addon ids, in the new order. */
  async reorder(guildId: number, body: unknown): Promise<GuildAddonList> {
    const { ids } = parse(ReorderGuildAddonsSchema, body);
    await this.assertGuild(guildId);
    const stored = (await listAddonRows(this.db, guildId)).map((r) => r.id);
    if (!isSameIdSet(stored, ids)) {
      throw new BadRequestException('ids must list every addon of the guild');
    }
    await writeAddonOrder(this.db, guildId, ids);
    return this.load(guildId);
  }

  private async load(guildId: number): Promise<GuildAddonList> {
    const [pinned, rows] = await Promise.all([
      readPinnedAddons(this.settings.get.bind(this.settings)),
      listAddonRows(this.db, guildId),
    ]);
    return { pinned, addons: rows.map(toGuildAddon) };
  }

  private async assertGuild(guildId: number): Promise<void> {
    if (!(await findGuild(this.db, guildId))) {
      throw new NotFoundException('Guild not found');
    }
  }

  private async assertNoCollision(
    guildId: number,
    link: ParsedAddonLink,
    exceptId?: number,
  ): Promise<void> {
    if (await hasAddonCollision(this.db, guildId, link, exceptId)) {
      throw new ConflictException(DUPLICATE);
    }
  }

  /** A concurrent duplicate (unwrapped 23505) still surfaces as 409. */
  private async guardUnique<T>(write: () => Promise<T>): Promise<T> {
    try {
      return await write();
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictException(DUPLICATE);
      throw err;
    }
  }
}

function parse<T>(schemaOf: ZodType<T>, body: unknown): T {
  const parsed = schemaOf.safeParse(body);
  if (!parsed.success) {
    throw new BadRequestException(parsed.error.flatten().fieldErrors);
  }
  return parsed.data;
}

function toLink(url: string): ParsedAddonLink {
  const result = parseAddonLink(url);
  if (!result.ok) throw new BadRequestException(result.error);
  return result.link;
}

function newRow(
  guildId: number,
  input: CreateGuildAddonInput,
  link: ParsedAddonLink,
  userId: number,
  sortOrder: number,
) {
  return {
    guildId,
    source: link.source,
    slugOrUrl: link.slugOrUrl,
    displayName: input.displayName ?? link.suggestedName,
    note: blankToNull(input.note),
    requirement: input.requirement,
    flavor: input.flavor ?? null,
    sortOrder,
    createdByUserId: userId,
    updatedByUserId: userId,
  };
}
