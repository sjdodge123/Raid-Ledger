/**
 * ROK-2187 — the signed-in owner's GG <year>: read the frozen snapshot
 * (never recomputed, AC1), the archive of past years (AC7) and the opt-in
 * public share toggle (AC8, off by default).
 */
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import {
  GgShareToggleDtoSchema,
  GgYearSchema,
  type GgArchiveDto,
  type GgOwnerSnapshotDto,
  type GgShareStateDto,
} from '@raid-ledger/contract';
import { NotDeactivatedGuard } from '../../../auth/not-deactivated.guard';
import type { AuthenticatedRequest } from '../../../auth/types';
import { DrizzleAsyncProvider } from '../../../drizzle/drizzle.module';
import * as schema from '../../../drizzle/schema';
import {
  toGgArchiveDto,
  toGgOwnerDto,
  toGgShareState,
} from './gg-dto.helpers';
import {
  findGgSnapshot,
  listGgArchive,
  setGgShare,
} from './gg-snapshot.queries';

/** `:year` path segment → a GG year, else 400. */
function parseYear(raw: string): number {
  const parsed = GgYearSchema.safeParse(Number(raw));
  if (!/^\d{4}$/.test(raw) || !parsed.success) {
    throw new BadRequestException('Invalid GG year');
  }
  return parsed.data;
}

@Controller('gg')
@UseGuards(AuthGuard('jwt'))
export class GgController {
  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  /** `GET /gg/archive` — every year the viewer has a GG for (R5). */
  @Get('archive')
  async archive(@Req() req: AuthenticatedRequest): Promise<GgArchiveDto> {
    return toGgArchiveDto(await listGgArchive(this.db, req.user.id));
  }

  /** `GET /gg/:year` — the stored snapshot only; 404 when none exists. */
  @Get(':year')
  async read(
    @Param('year') rawYear: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<GgOwnerSnapshotDto> {
    const year = parseYear(rawYear);
    const [row, archive] = await Promise.all([
      findGgSnapshot(this.db, req.user.id, year),
      listGgArchive(this.db, req.user.id),
    ]);
    if (!row) throw new NotFoundException(`No GG ${year} for this user`);
    return toGgOwnerDto(row, archive.map((a) => a.year));
  }

  /** `PUT /gg/:year/share` — on keeps/mints a slug; off nulls it (Q5). */
  @Put(':year/share')
  @UseGuards(NotDeactivatedGuard)
  async share(
    @Param('year') rawYear: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
  ): Promise<GgShareStateDto> {
    const year = parseYear(rawYear);
    const parsed = GgShareToggleDtoSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues);
    const row = await setGgShare(this.db, req.user.id, year, parsed.data.shared);
    if (!row) throw new NotFoundException(`No GG ${year} for this user`);
    return toGgShareState(row);
  }
}
