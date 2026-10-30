import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Request,
  UploadedFile,
  UseFilters,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { FileInterceptor } from '@nestjs/platform-express';
import type { GuildCrestEditorState } from '@raid-ledger/contract';
import type { AuthenticatedRequest } from '../../auth/types';
import { RateLimit } from '../../throttler/rate-limit.decorator';
import { GuildEditorGuard } from '../guild-editor.guard';
import { HubKindActiveGuard } from '../hub-kind-active.guard';
import { HubVisibleGuard } from '../hub-visible.guard';
import { HubCrestUploadTooLargeFilter } from './hub-crest-upload.filter';
import { crestMulterOptions } from './hub-crest.limits';
import { HubCrestService } from './hub-crest.service';

const jwt = AuthGuard('jwt');

/**
 * ROK-1814 — the hub crest routes (a Core hub behaviour for every kind, so
 * no plugin manifest entry, like `PATCH guilds/:id/name`). Every route is
 * editor-only (`GuildEditorGuard`: Leader, Officer, staff); the public
 * crest rides on `GuildSummary.crest`. Removing an upload is staff-only
 * (re-checked in the service). Each returns the `GuildCrestEditorState`.
 */
@Controller('guilds/:id/crest')
@UseGuards(HubKindActiveGuard)
export class HubCrestController {
  constructor(private readonly crests: HubCrestService) {}

  @Get()
  @UseGuards(jwt, HubVisibleGuard, GuildEditorGuard)
  @Header('Cache-Control', 'private, no-store')
  get(@Param('id', ParseIntPipe) id: number): Promise<GuildCrestEditorState> {
    return this.crests.get(id);
  }

  @Put()
  @UseGuards(jwt, HubVisibleGuard, GuildEditorGuard)
  set(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: unknown,
  ): Promise<GuildCrestEditorState> {
    return this.crests.set(req.user, id, body);
  }

  /** Multipart field `file` (≤ 1 MiB; multer's 413 gets `code: too_large`). */
  @Post('upload')
  @HttpCode(200)
  @RateLimit('upload')
  @UseGuards(jwt, HubVisibleGuard, GuildEditorGuard)
  @UseInterceptors(FileInterceptor('file', crestMulterOptions()))
  @UseFilters(HubCrestUploadTooLargeFilter)
  upload(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<GuildCrestEditorState> {
    if (!file) throw new BadRequestException('Choose a picture to upload.');
    return this.crests.upload(req.user, id, file.buffer);
  }

  /** Body `SetGuildCrestFromGallery` — a picture from THIS hub's gallery. */
  @Post('from-gallery')
  @HttpCode(200)
  @RateLimit('upload')
  @UseGuards(jwt, HubVisibleGuard, GuildEditorGuard)
  fromGallery(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: unknown,
  ): Promise<GuildCrestEditorState> {
    return this.crests.fromGallery(req.user, id, body);
  }

  @Delete('upload')
  @UseGuards(jwt, HubVisibleGuard, GuildEditorGuard)
  removeUpload(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<GuildCrestEditorState> {
    return this.crests.removeUpload(req.user, id);
  }
}
