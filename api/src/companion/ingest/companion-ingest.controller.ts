import {
  Controller,
  HttpCode,
  HttpException,
  HttpStatus,
  Logger,
  Param,
  Post,
  Req,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import {
  COMPANION_MESSAGE_MAX_BYTES,
  type CompanionIngestAck,
} from '@raid-ledger/contract';
import { readBoundedBody } from '../../common/bounded-body/bounded-body.reader';
import {
  COMPANION_CONTENT_TYPE,
  type CompanionBypassedRequest,
} from './companion-body-bypass';
import { CompanionConnectionCloseFilter } from './companion-connection-close.filter';
import { CompanionIngestAuthGuard } from './companion-ingest-auth.guard';
import { CompanionIngestRateLimitGuard } from './companion-ingest-rate-limit.guard';
import type { AuthenticatedCompanionIngestRequest } from './companion-ingest-request';
import { companionBodyErrors } from './companion-ingest.errors';
import { CompanionIngestService } from './companion-ingest.service';
import { assertContractParam } from './companion-ingest.steps';

type IngestRequest = AuthenticatedCompanionIngestRequest &
  CompanionBypassedRequest;

/**
 * `POST /companion/v1/messages/:contract` (ROK-1956 §4). Guards run before
 * any body read (auth → rate limit, D-8); the global JSON parser is bypassed
 * for this path, so the body is read here under the global cap, then the
 * service runs the documented steps. Every error answer closes the
 * connection. Logs ids + status only — never the token or the body.
 */
@Controller('companion/v1/messages')
@SkipThrottle()
@UseFilters(CompanionConnectionCloseFilter)
@UseGuards(CompanionIngestAuthGuard, CompanionIngestRateLimitGuard)
export class CompanionIngestController {
  private readonly logger = new Logger(CompanionIngestController.name);

  constructor(private readonly ingest: CompanionIngestService) {}

  /** 202 `{ status: 'accepted' | 'stale' }`. */
  @Post(':contract')
  @HttpCode(HttpStatus.ACCEPTED)
  async post(
    @Param('contract') raw: string,
    @Req() req: IngestRequest,
  ): Promise<CompanionIngestAck> {
    const auth = req.companionIngest;
    try {
      const contract = assertContractParam(raw);
      const body = await readBoundedBody(req, {
        maxBytes: COMPANION_MESSAGE_MAX_BYTES,
        contentType: 'application/json',
        errors: companionBodyErrors,
        rawContentType: req[COMPANION_CONTENT_TYPE],
      });
      return await this.ingest.ingest(auth, contract, body);
    } catch (err: unknown) {
      if (err instanceof HttpException) {
        this.logger.warn(
          `companion ingest user=${auth.userId} device=${auth.deviceId ?? '-'} result=${err.getStatus()}`,
        );
      }
      throw err;
    }
  }
}
