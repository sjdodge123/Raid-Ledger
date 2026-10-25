/**
 * ROK-1955 §5.2 items 1, 3, 4: start a link, preview it on the web, and the
 * signed-in user's explicit approve / deny. User-code lookups draw on a
 * per-user (10 / 10 min) and per-IP (30 / min) failure budget.
 */
import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import {
  CompanionLinkDecisionRequestSchema,
  CompanionLinkStartRequestSchema,
  CompanionLinkStartResponseSchema,
  type CompanionLinkDecisionRequest,
  type CompanionLinkPreview,
  type CompanionLinkStartResponse,
} from '@raid-ledger/contract';
import { handleValidationError } from '../../common/validation.util';
import { SettingsService } from '../../settings/settings.service';
import {
  hitOrThrow,
  reserveOrThrow,
  type HeaderSink,
} from './companion-device-link-budget';
import {
  codeNotFound,
  deviceLimit,
  tooManyPending,
} from './companion-device-link.errors';
import {
  codeFailsPerIpLimit,
  codeFailsPerUserLimit,
  CompanionDeviceRateLimiter,
  LINK_TTL_SEC,
  MAX_LIVE_DEVICES,
  MINUTE_MS,
  pendingPerNetworkLimit,
  POLL_INTERVAL_SEC,
  startPerIpLimit,
  TEN_MINUTES_MS,
} from './companion-device-link.limits';
import { CompanionDeviceLinksRepository } from './companion-device-links.repository';
import {
  toLinkPreview,
  type CompanionDeviceLinkRow,
} from './companion-device-dto.helpers';
import {
  coarseIp,
  deviceCodes,
  formatUserCode,
  generateUserCode,
  hashUserCode,
  parseUserCode,
} from './companion-device-token.helpers';
import { buildStartResponse } from './companion-device-link-start.helpers';

/** The decision outcome returned to the web. */
export interface CompanionLinkDecisionResult {
  status: 'approved' | 'denied';
}

/** Who is asking, for the user-code budgets. */
export interface CodeCaller {
  userId: number;
  ip: string | undefined;
}

const CODE_ATTEMPTS = 3;

@Injectable()
export class CompanionDeviceLinkService {
  constructor(
    private readonly repo: CompanionDeviceLinksRepository,
    private readonly limiter: CompanionDeviceRateLimiter,
    private readonly settings: SettingsService,
  ) {}

  /** Start a link (public). 429 per IP, 409 `too_many_pending` per network. */
  async start(
    body: unknown,
    ip: string | undefined,
    res: HeaderSink,
  ): Promise<CompanionLinkStartResponse> {
    const parsed = CompanionLinkStartRequestSchema.safeParse(body);
    if (!parsed.success) handleValidationError(parsed.error);
    const key = `companion-link:start:${ip ?? 'unknown'}`;
    hitOrThrow(
      this.limiter,
      res,
      { key, limit: startPerIpLimit(), windowMs: MINUTE_MS },
      'Too many link requests',
    );
    const network = coarseIp(ip);
    const cap = pendingPerNetworkLimit();
    if (
      network !== null &&
      cap !== null &&
      (await this.repo.countPendingForNetwork(network)) >= cap
    ) {
      throw tooManyPending();
    }
    const base = await this.settings.getTrustedClientUrl();
    if (!base)
      throw new InternalServerErrorException('CLIENT_URL is not configured');
    const { device } = parsed.data;
    for (let i = 0; i < CODE_ATTEMPTS; i += 1) {
      const deviceCode = deviceCodes.generate();
      const userCode = generateUserCode();
      const row = await this.repo.insertPending({
        deviceCodeHash: deviceCodes.hash(deviceCode),
        userCodeHash: hashUserCode(userCode),
        deviceName: device.name,
        deviceOs: device.os,
        deviceOsVersion: device.osVersion ?? null,
        appVersion: device.appVersion,
        requestedIpCoarse: network,
      });
      if (row)
        return CompanionLinkStartResponseSchema.parse(
          buildStartResponse(
            base,
            deviceCode,
            formatUserCode(userCode),
            LINK_TTL_SEC,
            POLL_INTERVAL_SEC,
          ),
        );
    }
    throw new InternalServerErrorException('Could not allocate a link code');
  }

  /** Preview a pending link (JWT). No state change. */
  async preview(
    caller: CodeCaller,
    rawCode: string,
    res: HeaderSink,
  ): Promise<CompanionLinkPreview> {
    return this.withCodeBudget(caller, res, async () => {
      const code = parseUserCode(rawCode);
      if (code === null) throw codeNotFound();
      const row = await this.repo.findLiveByUserCodeHash(hashUserCode(code));
      if (!row || row.status !== 'pending') throw codeNotFound();
      return toLinkPreview(row, code, caller.ip);
    });
  }

  /** Approve / deny (JWT + NotDeactivatedGuard). Explicit; never automatic. */
  async decide(
    caller: CodeCaller,
    body: unknown,
    res: HeaderSink,
  ): Promise<CompanionLinkDecisionResult> {
    const parsed = CompanionLinkDecisionRequestSchema.safeParse(body);
    if (!parsed.success) handleValidationError(parsed.error);
    const request = parsed.data;
    return this.withCodeBudget(caller, res, () =>
      this.decideCode(caller.userId, request),
    );
  }

  private async decideCode(
    userId: number,
    req: CompanionLinkDecisionRequest,
  ): Promise<CompanionLinkDecisionResult> {
    const hash = hashUserCode(req.userCode);
    const row = await this.repo.findLiveByUserCodeHash(hash);
    if (!row) throw codeNotFound();
    if (row.status !== 'pending') return settled(row, userId, req.decision);
    if (
      req.decision === 'approve' &&
      (await this.repo.countLiveDevices(userId)) >= MAX_LIVE_DEVICES
    ) {
      throw deviceLimit();
    }
    const status = req.decision === 'approve' ? 'approved' : 'denied';
    if (await this.repo.decide(row.id, userId, status, req.name ?? null))
      return { status };
    const fresh = await this.repo.findLiveByUserCodeHash(hash);
    if (!fresh || fresh.status === 'pending') throw codeNotFound();
    return settled(fresh, userId, req.decision);
  }

  /** Run a user-code lookup under both failure budgets; a 404 is a failure. */
  private async withCodeBudget<T>(
    caller: CodeCaller,
    res: HeaderSink,
    run: () => Promise<T>,
  ): Promise<T> {
    const settle = reserveOrThrow(
      this.limiter,
      res,
      [
        {
          key: `companion-link:code:user:${caller.userId}`,
          limit: codeFailsPerUserLimit(),
          windowMs: TEN_MINUTES_MS,
        },
        {
          key: `companion-link:code:ip:${caller.ip ?? 'unknown'}`,
          limit: codeFailsPerIpLimit(),
          windowMs: MINUTE_MS,
        },
      ],
      'Too many code attempts — wait a few minutes and try again',
    );
    let failed = false;
    try {
      return await run();
    } catch (err: unknown) {
      failed = err instanceof NotFoundException;
      throw err;
    } finally {
      settle(failed);
    }
  }
}

/** An already-decided link: same user + same decision is idempotent, else 404. */
function settled(
  row: CompanionDeviceLinkRow,
  userId: number,
  decision: 'approve' | 'deny',
): CompanionLinkDecisionResult {
  const same =
    decision === 'approve'
      ? row.status === 'approved' || row.status === 'consumed'
      : row.status === 'denied';
  if (row.decidedBy !== userId || !same) throw codeNotFound();
  return { status: decision === 'approve' ? 'approved' : 'denied' };
}
