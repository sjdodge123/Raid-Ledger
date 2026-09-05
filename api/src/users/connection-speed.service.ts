/**
 * ROK-1374 (C1) — the viewer's own downstream speed, and nothing else.
 *
 * PRIVACY (STRICT, AC20). The only values that ever reach the database are the
 * four columns named here: the figure, its source, when it was measured, and
 * when consent was given. No M-Lab server hostname or location, no latency or
 * jitter series, no IP-adjacent diagnostics, no raw ndt7 result object. The
 * browser reads `downloadMbps` off the ndt7 payload and discards the rest
 * before it is ever sent here.
 *
 * The figure is self-scoped: every method takes the authenticated user's own
 * id and there is no path that returns another user's speed. It is never put
 * in an embed or a DM.
 */
import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type {
  ConnectionSpeedDto,
  ConnectionSpeedSource,
  SetConnectionSpeedDto,
} from '@raid-ledger/contract';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';

/** The four permitted columns, read back. */
interface SpeedRow {
  connectionDownstreamMbps: string | null;
  connectionSpeedSource: string | null;
  connectionSpeedMeasuredAt: Date | null;
  speedTestConsentAt: Date | null;
}

const SPEED_COLUMNS = {
  connectionDownstreamMbps: schema.users.connectionDownstreamMbps,
  connectionSpeedSource: schema.users.connectionSpeedSource,
  connectionSpeedMeasuredAt: schema.users.connectionSpeedMeasuredAt,
  speedTestConsentAt: schema.users.speedTestConsentAt,
};

@Injectable()
export class ConnectionSpeedService {
  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  /** The caller's own figure. All-null for a user who never measured. */
  async get(userId: number): Promise<ConnectionSpeedDto> {
    const [row] = await this.db
      .select(SPEED_COLUMNS)
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);
    return toDto(row ?? null);
  }

  /**
   * Record a downstream figure.
   *
   * An `ndt7` figure without a consent stamp is refused (403): consent is what
   * authorises the measurement, and accepting the result of a measurement the
   * user never agreed to would launder the missing permission. A `manual`
   * figure needs no consent — typing a number is not a measurement.
   */
  async setSpeed(
    userId: number,
    input: SetConnectionSpeedDto,
  ): Promise<ConnectionSpeedDto> {
    if (input.source === 'ndt7') {
      const current = await this.get(userId);
      if (current.consentAt === null) {
        throw new ForbiddenException('SPEED_TEST_CONSENT_REQUIRED');
      }
    }
    return this.writeAndRead(userId, {
      connectionDownstreamMbps: String(input.downstreamMbps),
      connectionSpeedSource: input.source,
      connectionSpeedMeasuredAt: new Date(),
    });
  }

  /**
   * Grant or revoke consent to run the speed test.
   *
   * Revocation nulls the three speed columns as well as the stamp: withdrawing
   * consent deletes the datum, not merely the permission to collect it again.
   * Granting stamps consent only — it never invents a measurement.
   */
  async setConsent(
    userId: number,
    consent: boolean,
  ): Promise<ConnectionSpeedDto> {
    if (!consent) {
      // E19: revocation deletes the datum, not just the permission — the
      // three speed columns go with the stamp.
      return this.writeAndRead(userId, {
        speedTestConsentAt: null,
        connectionDownstreamMbps: null,
        connectionSpeedSource: null,
        connectionSpeedMeasuredAt: null,
      });
    }
    return this.writeAndRead(userId, { speedTestConsentAt: new Date() });
  }

  /** One UPDATE, returning exactly the four permitted columns. */
  private async writeAndRead(
    userId: number,
    values: Partial<SpeedRow>,
  ): Promise<ConnectionSpeedDto> {
    const [row] = await this.db
      .update(schema.users)
      .set(values)
      .where(eq(schema.users.id, userId))
      .returning(SPEED_COLUMNS);
    return toDto(row ?? null);
  }
}

/** `numeric` reads back as a string; a non-numeric value means "unknown". */
function toDto(row: SpeedRow | null): ConnectionSpeedDto {
  const raw = row?.connectionDownstreamMbps ?? null;
  const parsed = raw === null ? NaN : Number(raw);
  return {
    downstreamMbps: Number.isFinite(parsed) && parsed > 0 ? parsed : null,
    source: (row?.connectionSpeedSource as ConnectionSpeedSource) ?? null,
    measuredAt: row?.connectionSpeedMeasuredAt?.toISOString() ?? null,
    consentAt: row?.speedTestConsentAt?.toISOString() ?? null,
  };
}
