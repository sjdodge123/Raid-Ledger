import { open, type FileHandle } from 'node:fs/promises';
import {
  Controller,
  Get,
  Injectable,
  NotFoundException,
  Param,
  Req,
  Res,
  StreamableFile,
  UseGuards,
  UseInterceptors,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Response } from 'express';
import type { Observable } from 'rxjs';
import type { HubMediaVariant } from '@raid-ledger/contract';
import type { AuthenticatedExpressRequest } from '../auth/types';
import { RateLimit } from '../throttler/rate-limit.decorator';
import {
  HUB_MEDIA_NOT_FOUND,
  HubMediaReadService,
} from './hub-media-read.service';
import { HubMediaIdPipe, HubMediaVariantPipe } from './hub-media.pipes';

/** A stored rendition never changes under its id (random storage name, D3). */
export const HUB_MEDIA_BYTES_CACHE = 'private, max-age=604800, immutable';

/** Every response defaults to `no-store`; only served bytes get the immutable policy. */
@Injectable()
export class HubMediaNoStore implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    ctx.switchToHttp().getResponse<Response>().set('Cache-Control', 'no-store');
    return next.handle();
  }
}

/** Open read-only; a missing file (rows survive a restore, files may not) → 404. */
async function openMedia(
  abs: string,
): Promise<{ file: FileHandle; size: number }> {
  let file: FileHandle;
  try {
    file = await open(abs, 'r');
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException | null)?.code === 'ENOENT') {
      throw new NotFoundException(HUB_MEDIA_NOT_FOUND);
    }
    throw err;
  }
  try {
    return { file, size: (await file.stat()).size };
  } catch (err: unknown) {
    await file.close();
    throw err;
  }
}

/** ROK-1942 L2 — `image/webp` bytes of one rendition, members + staff (D7). */
@Controller('hubs/:guildId/media')
@UseGuards(AuthGuard('jwt'))
export class HubMediaBytesController {
  constructor(private readonly media: HubMediaReadService) {}

  @Get(':id/:variant')
  @RateLimit('media')
  @UseInterceptors(HubMediaNoStore)
  async bytes(
    @Param('guildId', HubMediaIdPipe) guildId: number,
    @Param('id', HubMediaIdPipe) id: number,
    @Param('variant', HubMediaVariantPipe) variant: HubMediaVariant,
    @Req() req: AuthenticatedExpressRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const abs = await this.media.filePath(req.user, guildId, id, variant);
    const { file, size } = await openMedia(abs);
    res.set({
      'Content-Type': 'image/webp',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': HUB_MEDIA_BYTES_CACHE,
    });
    return new StreamableFile(file.createReadStream(), {
      type: 'image/webp',
      length: size,
    });
  }
}
