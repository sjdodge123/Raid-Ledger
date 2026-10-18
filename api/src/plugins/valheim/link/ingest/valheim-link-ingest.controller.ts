import {
  Controller,
  HttpCode,
  HttpException,
  HttpStatus,
  Logger,
  NotFoundException,
  Param,
  Post,
  Req,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import {
  ValheimLinkMessageKindSchema,
  type ValheimLinkIngestResult,
  type ValheimLinkMessageKind,
} from '@raid-ledger/contract';
import type { Request } from 'express';
import { ValheimLinkRateLimitGuard } from '../valheim-link-rate-limit.guard';
import { ingestError, type ValheimLinkRequest } from '../valheim-link-request';
import { ValheimLinkConnectionCloseFilter } from '../valheim-link-connection-close.filter';
import { ValheimLinkBearerGuard } from '../valheim-link-token.guard';
import { readBoundedBody } from './valheim-link-body.reader';
import { VALHEIM_LINK_KIND_MAX_BYTES } from './valheim-link-message.parse';
import { ValheimLinkIngestService } from './valheim-link-ingest.service';

function kindOf(raw: string): ValheimLinkMessageKind {
  const parsed = ValheimLinkMessageKindSchema.safeParse(raw);
  if (!parsed.success) {
    throw new NotFoundException(ingestError('unknown_kind', 'unknown kind'));
  }
  return parsed.data;
}

/**
 * `POST /plugins/valheim/link/messages/:kind` (character | map | items) —
 * RL Valheim Link pushes one message per request (CONTRACT §1). The global
 * JSON parser is bypassed for this path (`valheim-link-body-bypass.ts`); the
 * body is read here, after the guards, under the kind's §7 cap.
 */
@Controller('plugins/valheim/link/messages')
@SkipThrottle()
@UseFilters(ValheimLinkConnectionCloseFilter)
@UseGuards(ValheimLinkBearerGuard, ValheimLinkRateLimitGuard)
export class ValheimLinkIngestController {
  private readonly logger = new Logger(ValheimLinkIngestController.name);

  constructor(private readonly ingest: ValheimLinkIngestService) {}

  /** 202 `ValheimLinkIngestResult` (`accepted` or `stale`). */
  @Post(':kind')
  @HttpCode(HttpStatus.ACCEPTED)
  async post(
    @Param('kind') rawKind: string,
    @Req() req: Request & ValheimLinkRequest,
  ): Promise<ValheimLinkIngestResult> {
    const kind = kindOf(rawKind);
    try {
      const body = await readBoundedBody(req, {
        maxBytes: VALHEIM_LINK_KIND_MAX_BYTES[kind],
        contentType: 'application/json',
      });
      return await this.ingest.ingest(req, kind, body);
    } catch (err: unknown) {
      if (err instanceof HttpException) {
        this.logger.warn(
          `valheim-link ingest kind=${kind} server=${req.valheimLink?.pelicanServerId ?? '-'} result=${err.getStatus()}`,
        );
      }
      throw err;
    }
  }
}
