import {
  BadRequestException,
  Controller,
  Header,
  HttpStatus,
  Param,
  Post,
  Req,
  Res,
  UploadedFile,
  UseFilters,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import type { HubMediaItem } from '@raid-ledger/contract';
import type { AuthenticatedExpressRequest } from '../auth/types';
import { RateLimit } from '../throttler/rate-limit.decorator';
import { HubMediaUploadService } from './hub-media-upload.service';
import { HubMediaUploadTooLargeFilter } from './hub-media-upload.filter';
import { HubMediaUploadGuard } from './hub-media-upload.guard';
import { uploadMulterOptions } from './hub-media-upload.limits';
import { HubMediaIdPipe } from './hub-media.pipes';

/**
 * ROK-1965 — `POST /hubs/:guildId/media`: a member adds one picture (field
 * `file`). 201 + the stored item; 200 + the existing item when the same
 * bytes are already on the hub. Errors carry a `code` (§6).
 */
@Controller('hubs/:guildId/media')
@UseGuards(AuthGuard('jwt'))
export class HubMediaUploadController {
  constructor(private readonly uploads: HubMediaUploadService) {}

  @Post()
  @RateLimit('upload')
  @UseGuards(HubMediaUploadGuard)
  @UseInterceptors(FileInterceptor('file', uploadMulterOptions()))
  @UseFilters(HubMediaUploadTooLargeFilter)
  @Header('Cache-Control', 'private, no-store')
  async upload(
    @Param('guildId', HubMediaIdPipe) guildId: number,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Req() req: AuthenticatedExpressRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<HubMediaItem> {
    if (!file) throw new BadRequestException('Choose a picture to upload.');
    const out = await this.uploads.upload(req.user, guildId, file.buffer);
    res.status(out.created ? HttpStatus.CREATED : HttpStatus.OK);
    return out.item;
  }
}
