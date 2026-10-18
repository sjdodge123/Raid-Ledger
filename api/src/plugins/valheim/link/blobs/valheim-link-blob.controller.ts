import {
  Controller,
  HttpException,
  HttpStatus,
  Logger,
  Param,
  Put,
  Req,
  Res,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { ValheimLinkBlobResult } from '@raid-ledger/contract';
import type { Request, Response } from 'express';
import {
  ValheimLinkRateBucket,
  ValheimLinkRateLimitGuard,
} from '../valheim-link-rate-limit.guard';
import type { ValheimLinkRequest } from '../valheim-link-request';
import { ValheimLinkConnectionCloseFilter } from '../valheim-link-connection-close.filter';
import { ValheimLinkBearerGuard } from '../valheim-link-token.guard';
import { ValheimLinkBlobService } from './valheim-link-blob.service';

/**
 * `PUT /plugins/valheim/link/blobs/:sha256` — raw PNG bytes,
 * `Content-Type: image/png`, identity encoding. 201 `stored` / 200 `exists`
 * (`ValheimLinkBlobResult`). The global parsers are bypassed for this path.
 */
@Controller('plugins/valheim/link/blobs')
@SkipThrottle()
@UseFilters(ValheimLinkConnectionCloseFilter)
@UseGuards(ValheimLinkBearerGuard, ValheimLinkRateLimitGuard)
@ValheimLinkRateBucket('blobs')
export class ValheimLinkBlobController {
  private readonly logger = new Logger(ValheimLinkBlobController.name);

  constructor(private readonly blobs: ValheimLinkBlobService) {}

  /** Upload one content-addressed PNG. */
  @Put(':sha256')
  async put(
    @Param('sha256') sha256: string,
    @Req() req: Request & ValheimLinkRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ValheimLinkBlobResult> {
    try {
      const result = await this.blobs.upload(req, sha256);
      res.status(
        result.status === 'stored' ? HttpStatus.CREATED : HttpStatus.OK,
      );
      return result;
    } catch (err: unknown) {
      if (err instanceof HttpException) {
        this.logger.warn(
          `valheim-link blob server=${req.valheimLink?.pelicanServerId ?? '-'} result=${err.getStatus()}`,
        );
      }
      throw err;
    }
  }
}
