import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { desc, eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import {
  ADDON_ERRORS_ADMIN_PAGE_SIZE,
  ADDON_ERRORS_EXPORT_MAX_ROWS,
  type AddonErrorDetailDto,
  type AddonErrorExportRowDto,
  type AddonErrorGroupDto,
  type AddonErrorGroupPageDto,
  type AddonErrorOccurrenceDto,
  type AddonErrorsFiltersDto,
  type AddonErrorsListQueryDto,
} from '@raid-ledger/contract';
import { DrizzleAsyncProvider } from '../../../drizzle/drizzle.module';
import * as schema from '../../../drizzle/schema';
import {
  addonErrorsWhere,
  signatureSql,
  toCharacters,
  toMembers,
} from './wow-addon-errors-admin.query';

type Db = PostgresJsDatabase<typeof schema>;
const t = schema.wowAddonErrorRecords;
const u = schema.users;

const lastSeenMax = sql<Date>`max(${t.lastSeenAt})`.mapWith(t.lastSeenAt);
const firstSeenMin = sql<Date>`min(${t.firstSeenAt})`.mapWith(t.firstSeenAt);

const groupColumns = {
  signature: signatureSql,
  addon: t.addon,
  message: t.message,
  totalCount: sql<number>`sum(${t.count})`.mapWith(Number),
  firstSeenAt: firstSeenMin,
  lastSeenAt: lastSeenMax,
  sampleStack: sql<
    string | null
  >`(array_agg(${t.stack} order by ${t.lastSeenAt} desc, ${t.id} desc))[1]`,
  members: sql<string>`jsonb_agg(distinct jsonb_build_object('userId', ${u.id}, 'username', ${u.username}))::text`,
  characters: sql<string>`coalesce(jsonb_agg(distinct jsonb_build_object('name', ${t.characterName}, 'realm', ${t.characterRealm})) filter (where ${t.characterName} is not null), '[]'::jsonb)::text`,
};

/** Columns of one stored record (detail + export). */
const recordColumns = {
  id: t.id,
  userId: t.userId,
  username: u.username,
  characterName: t.characterName,
  characterRealm: t.characterRealm,
  source: t.source,
  sourceVersion: t.sourceVersion,
  addon: t.addon,
  message: t.message,
  stack: t.stack,
  count: t.count,
  session: t.session,
  firstSeenAt: t.firstSeenAt,
  lastSeenAt: t.lastSeenAt,
  recordHash: t.recordHash,
  scrubbedCount: t.scrubbedCount,
};

/**
 * ROK-2099 (S3) — admin reads over `wow_addon_error_records`: groups by
 * `(addon, message)`, one group's records, and the export rows.
 */
@Injectable()
export class WowAddonErrorsAdminService {
  constructor(@Inject(DrizzleAsyncProvider) private readonly db: Db) {}

  /** One page of groups, most recently seen first. */
  async list(query: AddonErrorsListQueryDto): Promise<AddonErrorGroupPageDto> {
    const where = addonErrorsWhere(query);
    const pageSize = ADDON_ERRORS_ADMIN_PAGE_SIZE;
    const rows = await this.db
      .select(groupColumns)
      .from(t)
      .innerJoin(u, eq(u.id, t.userId))
      .where(where)
      .groupBy(t.addon, t.message)
      .orderBy(desc(lastSeenMax), t.addon, t.message)
      .limit(pageSize)
      .offset((query.page - 1) * pageSize);
    const groups = this.db
      .select({ one: sql`1` })
      .from(t)
      .where(where)
      .groupBy(t.addon, t.message)
      .as('g');
    const [count] = await this.db
      .select({ n: sql<number>`count(*)`.mapWith(Number) })
      .from(groups);
    return {
      items: rows.map(toGroup),
      total: count?.n ?? 0,
      page: query.page,
      pageSize,
    };
  }

  /** Every record of one group; 404 when the signature matches nothing. */
  async detail(signature: string): Promise<AddonErrorDetailDto> {
    const rows = await this.db
      .select(recordColumns)
      .from(t)
      .innerJoin(u, eq(u.id, t.userId))
      .where(sql`${signatureSql} = ${signature}`)
      .orderBy(desc(t.lastSeenAt), desc(t.id));
    const first = rows[0];
    if (!first) throw new NotFoundException('Addon error not found');
    return {
      signature,
      addon: first.addon,
      message: first.message,
      occurrences: rows.map((r) => toOccurrence(toExportRow(r))),
    };
  }

  /** Stored (scrubbed) records matching the filters, newest first, capped. */
  async exportRows(
    filters: AddonErrorsFiltersDto,
  ): Promise<AddonErrorExportRowDto[]> {
    const rows = await this.db
      .select(recordColumns)
      .from(t)
      .innerJoin(u, eq(u.id, t.userId))
      .where(addonErrorsWhere(filters))
      .orderBy(desc(t.lastSeenAt), desc(t.id))
      .limit(ADDON_ERRORS_EXPORT_MAX_ROWS);
    return rows.map(toExportRow);
  }
}

interface GroupRow {
  signature: string;
  addon: string;
  message: string;
  totalCount: number;
  firstSeenAt: Date;
  lastSeenAt: Date;
  sampleStack: string | null;
  members: string;
  characters: string;
}

function toGroup(r: GroupRow): AddonErrorGroupDto {
  return {
    signature: r.signature,
    addon: r.addon,
    message: r.message,
    members: toMembers(r.members),
    characters: toCharacters(r.characters),
    totalCount: r.totalCount,
    firstSeenAt: r.firstSeenAt.toISOString(),
    lastSeenAt: r.lastSeenAt.toISOString(),
    sampleStack: r.sampleStack,
  };
}

type RecordRow = Omit<AddonErrorExportRowDto, 'firstSeenAt' | 'lastSeenAt'> & {
  firstSeenAt: Date;
  lastSeenAt: Date;
};

function toOccurrence(row: AddonErrorExportRowDto): AddonErrorOccurrenceDto {
  return {
    id: row.id,
    member: { userId: row.userId, username: row.username },
    characterName: row.characterName,
    characterRealm: row.characterRealm,
    source: row.source,
    sourceVersion: row.sourceVersion,
    count: row.count,
    firstSeenAt: row.firstSeenAt,
    lastSeenAt: row.lastSeenAt,
    stack: row.stack,
  };
}

function toExportRow(r: RecordRow): AddonErrorExportRowDto {
  return {
    ...r,
    firstSeenAt: r.firstSeenAt.toISOString(),
    lastSeenAt: r.lastSeenAt.toISOString(),
  };
}
