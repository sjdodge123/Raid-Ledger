/**
 * ROK-1956 §5 — the HANDLER half of the companion contract registry (the data
 * half is `COMPANION_CONTRACTS` in the contract package). Each contract
 * version is handled by exactly one plugin-owned handler (ROK-1969 rule:
 * `register(ownerPluginId, handler)`, the hub-media decorator shape). A
 * contract version is enabled iff it is in the table, a handler is registered
 * for it, and the owner plugin is active — read per call, so deactivating a
 * plugin disables its contracts immediately (D-2, D-3).
 */
import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  COMPANION_CONTRACTS,
  type CompanionContractTable,
  type CompanionContractVersionSpec,
  type CompanionWebpRef,
} from '@raid-ledger/contract';
import { PluginRegistryService } from '../../plugins/plugin-host/plugin-registry.service';
import type { CompanionDeviceTx } from '../devices/companion-device-lock';
import type { CompanionIngestVia } from './companion-ingest-request';

/** DI token: the contract table (specs inject synthetic contracts). */
export const COMPANION_CONTRACT_TABLE = Symbol('COMPANION_CONTRACT_TABLE');
/** Spike §3.3 — the default upload cadence surfaced in `/config`. */
export const COMPANION_DEFAULT_MIN_INTERVAL_SEC = 120;
const DEFAULT_SOURCES: readonly CompanionIngestVia[] = Object.freeze([
  'device',
]);

/** What a handler gets for one accepted message. */
export interface CompanionHandlerContext {
  /** The ingest transaction — use it, never the outer db. */
  tx: CompanionDeviceTx;
  userId: number;
  via: CompanionIngestVia;
  deviceId: number | null;
  receivedAt: Date;
}

/** One plugin's handler for one contract id (one or more versions). */
export interface CompanionContractHandler<M = unknown> {
  /** A `COMPANION_CONTRACTS` id. */
  contract: string;
  /** Each listed for that id with status ≠ `retired`. */
  versions: readonly number[];
  /** Default `['device']` — the session (browser) path is opt-in (Q2). */
  sources?: readonly CompanionIngestVia[];
  /** Default 120 s; surfaced in `/config`. */
  cadence?: { minIntervalSec: number };
  latestWins?(msg: M): { key: string; at: Date } | null;
  blobRefs?(msg: M): readonly CompanionWebpRef[];
  handle(ctx: CompanionHandlerContext, msg: M): Promise<void>;
}

/** One registration as `/config` reports it. */
export interface CompanionHandlerListing {
  ownerPluginId: string;
  contract: string;
  versions: readonly number[];
  sources: readonly CompanionIngestVia[];
  cadence: { minIntervalSec: number };
  /** The owner plugin is active right now. */
  active: boolean;
}

/** The plugin-activity read the registry needs. */
export type CompanionPluginActivity = Pick<PluginRegistryService, 'isActive'>;

interface Registration {
  ownerPluginId: string;
  handler: CompanionContractHandler;
}

/** Own-key read (never a prototype key such as `__proto__`). */
function ownEntry<T>(
  table: Readonly<Record<string, T>>,
  key: string,
): T | undefined {
  return Object.entries(table).find(([k]) => k === key)?.[1];
}

/** Throws unless `handler` may be registered against `table`. */
function assertRegistrable(
  table: CompanionContractTable,
  owner: string,
  handler: CompanionContractHandler,
): void {
  const name = `companion handler ${handler.contract}`;
  if (owner.trim() === '') throw new Error(`${name}: empty owner plugin id`);
  const versions = ownEntry(table, handler.contract);
  if (!versions) throw new Error(`${name}: not a registered contract`);
  if (handler.versions.length === 0) throw new Error(`${name}: no versions`);
  if (new Set(handler.versions).size !== handler.versions.length) {
    throw new Error(`${name}: repeated version`);
  }
  for (const v of handler.versions) assertVersion(name, versions, v);
  if (handler.sources?.length === 0) throw new Error(`${name}: empty sources`);
  const interval = handler.cadence?.minIntervalSec;
  if (interval !== undefined && !(Number.isInteger(interval) && interval > 0)) {
    throw new Error(`${name}: cadence must be a positive integer`);
  }
}

function assertVersion(
  name: string,
  versions: Readonly<Record<number, CompanionContractVersionSpec>>,
  version: number,
): void {
  const spec = ownEntry(versions, String(version));
  if (!spec) throw new Error(`${name}: v${version} is not listed`);
  if (spec.status === 'retired')
    throw new Error(`${name}: v${version} is retired`);
}

/** Per-plugin companion contract handlers (exported by the ingest module). */
@Injectable()
export class CompanionHandlerRegistry {
  private readonly byVersion = new Map<string, Registration>();
  private readonly registrations: Registration[] = [];
  private readonly table: CompanionContractTable;

  constructor(
    @Inject(PluginRegistryService)
    private readonly plugins: CompanionPluginActivity,
    @Optional()
    @Inject(COMPANION_CONTRACT_TABLE)
    table?: CompanionContractTable,
  ) {
    this.table = table ?? COMPANION_CONTRACTS;
  }

  /**
   * Register `handler` for its contract versions, owned by `ownerPluginId`.
   * Call from the owning module's `onModuleInit`. Throws (a boot error) on an
   * unknown id, an unlisted/retired/repeated version, empty versions/sources,
   * an empty owner, or a `(contract, version)` another handler already owns.
   * All-or-nothing: a throw registers nothing.
   */
  register<M>(
    ownerPluginId: string,
    handler: CompanionContractHandler<M>,
  ): void {
    const h: CompanionContractHandler = handler;
    assertRegistrable(this.table, ownerPluginId, h);
    for (const v of h.versions) {
      const taken = this.byVersion.get(keyOf(h.contract, v));
      if (taken) {
        throw new Error(
          `companion handler ${h.contract} v${v} is already registered by ${taken.ownerPluginId}`,
        );
      }
    }
    const reg: Registration = { ownerPluginId, handler: h };
    for (const v of h.versions) this.byVersion.set(keyOf(h.contract, v), reg);
    this.registrations.push(reg);
  }

  /**
   * The handler for `(contract, version)` reachable via `via`, or null when
   * none is registered, its owner plugin is inactive, or `via` is not one of
   * its sources (→ 404 `unknown_contract`, D-3).
   */
  resolve(
    contract: string,
    version: number,
    via: CompanionIngestVia,
  ): CompanionContractHandler | null {
    const reg = this.byVersion.get(keyOf(contract, version));
    if (!reg || !this.plugins.isActive(reg.ownerPluginId)) return null;
    return sourcesOf(reg.handler).includes(via) ? reg.handler : null;
  }

  /** Every registration in order, with its owner's activity now (for `/config`). */
  list(): readonly CompanionHandlerListing[] {
    return this.registrations.map(({ ownerPluginId, handler }) => ({
      ownerPluginId,
      contract: handler.contract,
      versions: handler.versions,
      sources: sourcesOf(handler),
      cadence: {
        minIntervalSec:
          handler.cadence?.minIntervalSec ?? COMPANION_DEFAULT_MIN_INTERVAL_SEC,
      },
      active: this.plugins.isActive(ownerPluginId),
    }));
  }
}

function keyOf(contract: string, version: number): string {
  return `${contract}\u0000${version}`;
}

function sourcesOf(
  handler: CompanionContractHandler,
): readonly CompanionIngestVia[] {
  return handler.sources ?? DEFAULT_SOURCES;
}
