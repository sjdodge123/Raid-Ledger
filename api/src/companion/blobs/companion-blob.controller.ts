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
import type { CompanionBlobAck } from '@raid-ledger/contract';
import type { Response } from 'express';
import { CompanionConnectionCloseFilter } from '../ingest/companion-connection-close.filter';
import { CompanionIngestAuthGuard } from '../ingest/companion-ingest-auth.guard';
import {
  CompanionIngestRateBucket,
  CompanionIngestRateLimitGuard,
} from '../ingest/companion-ingest-rate-limit.guard';
import type { AuthenticatedCompanionIngestRequest } from '../ingest/companion-ingest-request';
import {
  CompanionBlobService,
  type CompanionBlobUpload,
} from './companion-blob.service';

type BlobRequest = AuthenticatedCompanionIngestRequest & CompanionBlobUpload;

/**
 * `PUT /companion/v1/blobs/:sha256` (ROK-1956 §7) — raw WebP bytes,
 * `Content-Type: image/webp`, identity encoding. 201 `stored` / 200 `exists`
 * (`CompanionBlobAck`). Guards run before any body read (auth → rate limit,
 * bucket `blobs`); the global parsers are bypassed for this path. An
 * `exists` answer never reads the body, so it closes the connection (D-16),
 * as does every error answer.
 */
@Controller('companion/v1/blobs')
@SkipThrottle()
@UseFilters(CompanionConnectionCloseFilter)
@UseGuards(CompanionIngestAuthGuard, CompanionIngestRateLimitGuard)
@CompanionIngestRateBucket('blobs')
export class CompanionBlobController {
  private readonly logger = new Logger(CompanionBlobController.name);

  constructor(private readonly blobs: CompanionBlobService) {}

  /** Upload one content-addressed WebP. */
  @Put(':sha256')
  async put(
    @Param('sha256') sha256: string,
    @Req() req: BlobRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<CompanionBlobAck> {
    const auth = req.companionIngest;
    try {
      const ack = await this.blobs.upload(auth, sha256, req);
      if (ack.status === 'exists') res.setHeader('Connection', 'close');
      res.status(ack.status === 'stored' ? HttpStatus.CREATED : HttpStatus.OK);
      return ack;
    } catch (err: unknown) {
      if (err instanceof HttpException) {
        this.logger.warn(
          `companion blob user=${auth.userId} device=${auth.deviceId ?? '-'} result=${err.getStatus()}`,
        );
      }
      throw err;
    }
  }
}
