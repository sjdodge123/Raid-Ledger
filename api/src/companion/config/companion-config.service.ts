/**
 * ROK-1956 §8 / D-19 — the body of `GET /companion/v1/config`. Anonymous
 * callers get `minAppVersion` + the global limits only (an un-linked old app
 * learns it is too old; which plugins are on is not shown). A device or
 * session caller also gets its rate limits and every registry contract.
 * The server does NOT enforce `minAppVersion` (Q8) — it is advice to the app.
 * Every answer is parsed through `CompanionConfigSchema` before it is sent.
 */
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  COMPANION_CAPTURED_AT_MAX_FUTURE_MS,
  COMPANION_CONTRACTS,
  COMPANION_IMAGE_EDGE_MAX,
  COMPANION_MESSAGE_MAX_BYTES,
  COMPANION_WEBP_MAX_BYTES,
  CompanionConfigSchema,
  CompanionVersionStringSchema,
  type CompanionConfig,
  type CompanionConfigContract,
  type CompanionConfigLimits,
  type CompanionConfigRate,
  type CompanionContractTable,
  type CompanionContractVersionSpec,
} from '@raid-ledger/contract';
import {
  COMPANION_CONTRACT_TABLE,
  COMPANION_DEFAULT_MIN_INTERVAL_SEC,
  CompanionHandlerRegistry,
} from '../ingest/companion-handler.registry';
import { callerRatePerMin } from '../ingest/companion-ingest-rate-limit.guard';
import type {
  CompanionIngestAuth,
  CompanionIngestVia,
} from '../ingest/companion-ingest-request';

/** No minimum unless the operator sets `COMPANION_MIN_APP_VERSION`. */
export const DEFAULT_COMPANION_MIN_APP_VERSION = '0.0.0';

const LIMITS: CompanionConfigLimits = Object.freeze({
  messageMaxBytes: COMPANION_MESSAGE_MAX_BYTES,
  webpMaxBytes: COMPANION_WEBP_MAX_BYTES,
  imageEdgeMax: COMPANION_IMAGE_EDGE_MAX,
  capturedAtMaxFutureMs: COMPANION_CAPTURED_AT_MAX_FUTURE_MS,
});

interface VersionEntry {
  version: number;
  spec: CompanionContractVersionSpec;
}

/** Versions ascending. */
function versionEntries(
  versions: Readonly<Record<number, CompanionContractVersionSpec>>,
): VersionEntry[] {
  return Object.entries(versions)
    .map(([k, spec]) => ({ version: Number(k), spec }))
    .sort((a, b) => a.version - b.version);
}

/** Highest `current` version, else the highest of any status. */
function currentEntry(entries: VersionEntry[]): VersionEntry | undefined {
  const current = entries.filter((e) => e.spec.status === 'current');
  return (current.length > 0 ? current : entries).at(-1);
}

/** The caller's per-minute caps (`null` = unlimited). */
function rateFor(via: CompanionIngestVia): CompanionConfigRate {
  return {
    messagesPerMin: callerRatePerMin('messages', via),
    blobsPerMin: callerRatePerMin('blobs', via),
  };
}

@Injectable()
export class CompanionConfigService {
  private readonly logger = new Logger(CompanionConfigService.name);
  private readonly table: CompanionContractTable;

  constructor(
    private readonly registry: CompanionHandlerRegistry,
    @Optional()
    @Inject(COMPANION_CONTRACT_TABLE)
    table?: CompanionContractTable,
  ) {
    this.table = table ?? COMPANION_CONTRACTS;
  }

  /** The `/config` body for `auth` (null = anonymous), schema-parsed. */
  build(auth: CompanionIngestAuth | null): CompanionConfig {
    const base = {
      configVersion: 1 as const,
      minAppVersion: this.minAppVersion(),
      limits: { ...LIMITS },
    };
    if (auth === null) return CompanionConfigSchema.parse(base);
    return CompanionConfigSchema.parse({
      ...base,
      rate: rateFor(auth.via),
      contracts: this.contracts(auth.via),
    });
  }

  /** `COMPANION_MIN_APP_VERSION` when valid, else the default (read per call). */
  private minAppVersion(): string {
    const raw = process.env.COMPANION_MIN_APP_VERSION?.trim();
    if (!raw) return DEFAULT_COMPANION_MIN_APP_VERSION;
    if (CompanionVersionStringSchema.safeParse(raw).success) return raw;
    this.logger.warn('COMPANION_MIN_APP_VERSION is not a version; ignored');
    return DEFAULT_COMPANION_MIN_APP_VERSION;
  }

  private contracts(via: CompanionIngestVia): CompanionConfigContract[] {
    return Object.entries(this.table).flatMap(([id, versions]) => {
      const entry = this.contract(id, versionEntries(versions), via);
      return entry ? [entry] : [];
    });
  }

  /** One contract as served now; `enabled` = its current version resolves. */
  private contract(
    id: string,
    entries: VersionEntry[],
    via: CompanionIngestVia,
  ): CompanionConfigContract | null {
    const current = currentEntry(entries);
    if (!current) return null;
    const listing = this.registry
      .list()
      .find((l) => l.contract === id && l.versions.includes(current.version));
    return {
      id,
      enabled: this.registry.resolve(id, current.version, via) !== null,
      versions: entries.map((e) => ({
        version: e.version,
        status: e.spec.status,
      })),
      maxBytes: current.spec.maxBytes,
      blobSlots: [...current.spec.blobSlots],
      cadence: listing?.cadence ?? {
        minIntervalSec: COMPANION_DEFAULT_MIN_INTERVAL_SEC,
      },
    };
  }
}
