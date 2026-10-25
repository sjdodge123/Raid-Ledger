/**
 * ROK-1956 §4.1 — the messages pipeline after the body is read: the pure
 * steps (3–10), then step 11 in one transaction (device revalidation →
 * stored-blob ref check → latest-wins compare-and-set → ref upsert →
 * handler). A stale message commits nothing
 * and never reaches the handler (Q3). Logs ids, contract, version and the
 * result only — never the body or payload values.
 */
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  COMPANION_CONTRACTS,
  type CompanionContractTable,
  type CompanionIngestAck,
} from '@raid-ledger/contract';
import {
  assertRefsMatchStored,
  uniqueBlobRefs,
  type CompanionBlobRefRow,
} from '../blobs/companion-blob-refs.helpers';
import type { CompanionDeviceTx } from '../devices/companion-device-lock';
import {
  COMPANION_CONTRACT_TABLE,
  CompanionHandlerRegistry,
} from './companion-handler.registry';
import { CompanionIngestLatestRepository } from './companion-ingest-latest.repository';
import type { CompanionIngestAuth } from './companion-ingest-request';
import { companionUnauthorized } from './companion-ingest.errors';
import {
  latestMarkerOf,
  validateCompanionMessage,
  type CompanionLatestMarker,
  type ValidatedCompanionMessage,
} from './companion-ingest.steps';

type AckStatus = CompanionIngestAck['status'];

/** Validates and commits one companion message. */
@Injectable()
export class CompanionIngestService {
  private readonly logger = new Logger(CompanionIngestService.name);
  private readonly table: CompanionContractTable;

  constructor(
    private readonly registry: CompanionHandlerRegistry,
    private readonly repo: CompanionIngestLatestRepository,
    @Optional()
    @Inject(COMPANION_CONTRACT_TABLE)
    table?: CompanionContractTable,
  ) {
    this.table = table ?? COMPANION_CONTRACTS;
  }

  /** Steps 3–12 for a decoded body posted to `:contract` (already step-1 checked). */
  async ingest(
    auth: CompanionIngestAuth,
    contract: string,
    body: Buffer,
    now: Date = new Date(),
  ): Promise<CompanionIngestAck> {
    const msg = validateCompanionMessage(contract, body, {
      table: this.table,
      resolve: (c, v) => this.registry.resolve(c, v, auth.via),
      now,
    });
    const marker = latestMarkerOf(msg.handler, msg.message);
    const status = await this.repo.transaction((tx) =>
      this.commit(tx, auth, msg, marker, now),
    );
    this.logger.log(
      `companion ingest user=${auth.userId} device=${auth.deviceId ?? '-'} contract=${msg.contract} v=${msg.version} bytes=${body.length} result=${status}`,
    );
    return { status };
  }

  /** Step 11 inside the transaction; a throw rolls the marker back. */
  private async commit(
    tx: CompanionDeviceTx,
    auth: CompanionIngestAuth,
    msg: ValidatedCompanionMessage,
    marker: CompanionLatestMarker | null,
    receivedAt: Date,
  ): Promise<AckStatus> {
    await this.assertDeviceHeld(tx, auth);
    const refs = await this.checkBlobRefs(tx, auth.userId, msg);
    if (marker) {
      const row = { userId: auth.userId, contract: msg.contract, ...marker };
      if (!(await this.repo.advance(tx, row))) return 'stale';
    }
    await this.repo.recordBlobRefs(tx, auth.userId, msg.contract, refs);
    const { userId, via, deviceId } = auth;
    await msg.handler.handle(
      { tx, userId, via, deviceId, receivedAt },
      msg.message,
    );
    return 'accepted';
  }

  /** Step 11b: the message's refs must agree with any blob already stored. */
  private async checkBlobRefs(
    tx: CompanionDeviceTx,
    userId: number,
    msg: ValidatedCompanionMessage,
  ): Promise<CompanionBlobRefRow[]> {
    const refs = uniqueBlobRefs(msg.handler.blobRefs?.(msg.message) ?? []);
    if (refs.length === 0) return refs;
    const shas = refs.map((r) => r.sha256);
    assertRefsMatchStored(refs, await this.repo.storedBlobs(tx, userId, shas));
    return refs;
  }

  /** Step 11a: the device path's token must still be live at commit. */
  private async assertDeviceHeld(
    tx: CompanionDeviceTx,
    auth: CompanionIngestAuth,
  ): Promise<void> {
    if (auth.via !== 'device') return;
    const { deviceId, tokenHash } = auth;
    if (deviceId === null || tokenHash === null) throw companionUnauthorized();
    if (!(await this.repo.holdDevice(tx, { deviceId, tokenHash }))) {
      throw companionUnauthorized();
    }
  }
}
