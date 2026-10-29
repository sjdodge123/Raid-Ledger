/**
 * ROK-1955 §5.2 item 2: the RFC 8628 poll. The token is minted here, at
 * the winning `approved → consumed` UPDATE, and returned exactly once.
 * Never logs the device code or the token.
 */
import { Injectable } from '@nestjs/common';
import {
  CompanionLinkPollRequestSchema,
  CompanionLinkPollSuccessSchema,
  type CompanionLinkPollSuccess,
} from '@raid-ledger/contract';
import { tokenHashesEqual } from '../../common/tokens/prefixed-token.helpers';
import {
  reserveOrThrow,
  type HeaderSink,
} from './companion-device-link-budget';
import {
  deviceLimit,
  isInvalidGrant,
  pollError,
} from './companion-device-link.errors';
import {
  CompanionDeviceRateLimiter,
  MAX_LIVE_DEVICES,
  MINUTE_MS,
  pollFailsPerIpLimit,
} from './companion-device-link.limits';
import { CompanionDeviceLinksRepository } from './companion-device-links.repository';
import {
  toCompanionDeviceDto,
  type CompanionDeviceLinkRow,
} from './companion-device-dto.helpers';
import {
  companionDeviceTokens,
  deviceCodes,
} from './companion-device-token.helpers';

const isExpired = (row: CompanionDeviceLinkRow): boolean =>
  row.expiresAt.getTime() <= Date.now();

@Injectable()
export class CompanionDeviceLinkPollService {
  constructor(
    private readonly repo: CompanionDeviceLinksRepository,
    private readonly limiter: CompanionDeviceRateLimiter,
  ) {}

  /**
   * One poll. Malformed / unknown / already-used codes are `invalid_grant`
   * and count against the caller IP's failure budget (30/min, reserved
   * before the lookup); every other answer refunds its slot.
   */
  async poll(
    body: unknown,
    ip: string | undefined,
    res: HeaderSink,
  ): Promise<CompanionLinkPollSuccess> {
    const settle = reserveOrThrow(
      this.limiter,
      res,
      [
        {
          key: `companion-link:poll:${ip ?? 'unknown'}`,
          limit: pollFailsPerIpLimit(),
          windowMs: MINUTE_MS,
        },
      ],
      'Too many failed device-code attempts',
    );
    let failed = false;
    try {
      return await this.pollOnce(body);
    } catch (err: unknown) {
      failed = isInvalidGrant(err);
      throw err;
    } finally {
      settle(failed);
    }
  }

  private async pollOnce(body: unknown): Promise<CompanionLinkPollSuccess> {
    const parsed = CompanionLinkPollRequestSchema.safeParse(body);
    if (!parsed.success) throw pollError('invalid_grant');
    const hash = deviceCodes.hash(parsed.data.deviceCode);
    const row = await this.repo.findByDeviceCodeHash(hash);
    if (!row || !tokenHashesEqual(row.deviceCodeHash, hash)) {
      throw pollError('invalid_grant');
    }
    return this.answer(row, true);
  }

  /** Answer from the row's state; `retry` allows one re-read after a lost race. */
  private async answer(
    row: CompanionDeviceLinkRow,
    retry: boolean,
  ): Promise<CompanionLinkPollSuccess> {
    if (row.status === 'consumed') throw pollError('invalid_grant');
    if (isExpired(row)) throw pollError('expired_token');
    if (row.status === 'denied') throw pollError('access_denied');
    if (row.status === 'approved') return this.consume(row, retry);
    const stamp = await this.repo.stampPendingPoll(row.id);
    if (stamp?.tooFast) throw pollError('slow_down', stamp.intervalSec);
    if (stamp) throw pollError('authorization_pending');
    return this.reread(row, retry);
  }

  /** Mint, then win the conditional UPDATE — or answer from the new state. */
  private async consume(
    row: CompanionDeviceLinkRow,
    retry: boolean,
  ): Promise<CompanionLinkPollSuccess> {
    if (row.decidedBy === null) throw pollError('invalid_grant');
    const token = companionDeviceTokens.generate();
    const result = await this.repo.consume(
      row,
      row.decidedBy,
      {
        tokenHash: companionDeviceTokens.hash(token),
        tokenHint: companionDeviceTokens.hintOf(token),
      },
      MAX_LIVE_DEVICES,
    );
    if (result.kind === 'device_limit') throw deviceLimit();
    if (result.kind === 'lost') return this.reread(row, retry);
    return CompanionLinkPollSuccessSchema.parse({
      token,
      tokenType: 'Bearer',
      device: toCompanionDeviceDto(result.device),
    });
  }

  /** Lost a race: re-read once and answer from the winner's state. */
  private async reread(
    row: CompanionDeviceLinkRow,
    retry: boolean,
  ): Promise<CompanionLinkPollSuccess> {
    const fresh = retry
      ? await this.repo.findByDeviceCodeHash(row.deviceCodeHash)
      : null;
    if (!fresh) throw pollError('invalid_grant');
    return this.answer(fresh, false);
  }
}
