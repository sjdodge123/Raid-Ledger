/**
 * ROK-1956 §4.1 steps 1 and 3–10 — the pure checks of the messages route,
 * in the companion CONTRACT order: (global cap is the reader's, step 2) →
 * envelope parse → path/body contract match → contract-table lookup →
 * handler resolve → per-contract cap → payload schema → clock rule. Each
 * failure throws the §9 companion error; nothing here touches the db.
 */
import {
  COMPANION_CAPTURED_AT_MAX_FUTURE_MS,
  CompanionContractIdSchema,
  CompanionEnvelopeSchema,
  lookupCompanionContract,
  type CompanionContractLookup,
  type CompanionContractTable,
  type CompanionContractVersionSpec,
  type CompanionEnvelope,
} from '@raid-ledger/contract';
import { COMPANION_LATEST_KEY_MAX_CHARS } from '../../drizzle/schema/companion-ingest';
import type { CompanionContractHandler } from './companion-handler.registry';
import { companionError, companionIssues } from './companion-ingest.errors';

const UTF8 = new TextDecoder('utf-8', { fatal: true });

function unknownContract(): Error {
  return companionError('unknown_contract', 'Unknown contract');
}

/** Step 1 (no body read): a malformed `:contract` → 404 `unknown_contract`. */
export function assertContractParam(raw: string): string {
  if (!CompanionContractIdSchema.safeParse(raw).success) throw unknownContract();
  return raw;
}

/** Step 3: strict UTF-8 + `JSON.parse`, else 400 `invalid_envelope`. */
function parseJson(body: Buffer): unknown {
  try {
    return JSON.parse(UTF8.decode(body)) as unknown;
  } catch {
    throw companionError('invalid_envelope', 'Body is not valid JSON');
  }
}

/** Steps 3–4: the stage-one envelope (payload opaque), with issues on failure. */
export function parseEnvelope(body: Buffer): {
  envelope: CompanionEnvelope;
  json: unknown;
} {
  const json = parseJson(body);
  const parsed = CompanionEnvelopeSchema.safeParse(json);
  if (!parsed.success) {
    throw companionError('invalid_envelope', 'Envelope is not valid', {
      issues: companionIssues(parsed.error.issues),
    });
  }
  return { envelope: parsed.data, json };
}

/** Step 5 (D-9): the body's `contract` MUST equal the path's. */
export function assertContractMatches(
  envelope: CompanionEnvelope,
  param: string,
): void {
  if (envelope.contract !== param) {
    throw companionError(
      'invalid_envelope',
      'Envelope contract does not match the route',
    );
  }
}

/** Step 6: a contract-table lookup → its spec, or the §9 version error. */
export function specFor(
  lookup: CompanionContractLookup,
): CompanionContractVersionSpec {
  switch (lookup.kind) {
    case 'ok':
      return lookup.spec;
    case 'unknown_contract':
      throw unknownContract();
    case 'unknown_contract_version':
      throw companionError('unknown_contract_version', 'Unknown version', {
        currentVersion: lookup.current,
      });
    case 'retired':
      throw companionError('retired_contract_version', 'Version is retired', {
        currentVersion: lookup.current,
      });
  }
}

/** Step 9: the full-message schema; issues carry path + code only. */
export function parseMessage(
  spec: CompanionContractVersionSpec,
  json: unknown,
): unknown {
  const parsed = spec.schema.safeParse(json);
  if (!parsed.success) {
    throw companionError('invalid_payload', 'Payload is not valid', {
      issues: companionIssues(parsed.error.issues),
    });
  }
  return parsed.data;
}

/** Step 10 (D-10): `capturedAt` at most 300 000 ms ahead of `now`. */
export function assertNotFromFuture(capturedAt: string, now: Date): void {
  const at = Date.parse(capturedAt);
  if (!(at - now.getTime() <= COMPANION_CAPTURED_AT_MAX_FUTURE_MS)) {
    throw companionError('captured_at_in_future', 'capturedAt is in the future');
  }
}

/** Collaborators of {@link validateCompanionMessage}. */
export interface CompanionValidateDeps {
  table: CompanionContractTable;
  /** Step 7: the handler reachable for the caller, or null. */
  resolve(contract: string, version: number): CompanionContractHandler | null;
  now: Date;
}

/** A message that passed steps 3–10. */
export interface ValidatedCompanionMessage {
  contract: string;
  version: number;
  handler: CompanionContractHandler;
  message: unknown;
}

/** Steps 3–10 on a decoded body already under the global cap. */
export function validateCompanionMessage(
  param: string,
  body: Buffer,
  deps: CompanionValidateDeps,
): ValidatedCompanionMessage {
  const { envelope, json } = parseEnvelope(body);
  assertContractMatches(envelope, param);
  const { contract, contractVersion: version } = envelope;
  const spec = specFor(lookupCompanionContract(contract, version, deps.table));
  const handler = deps.resolve(contract, version);
  if (!handler) throw unknownContract();
  if (body.length > spec.maxBytes) {
    throw companionError('payload_too_large', 'Message is too large');
  }
  const message = parseMessage(spec, json);
  assertNotFromFuture(envelope.capturedAt, deps.now);
  return { contract, version, handler, message };
}

/** A handler's latest-wins marker for one message. */
export interface CompanionLatestMarker {
  key: string;
  at: Date;
}

/**
 * The handler's `latestWins` marker (null = no dedupe). A key over 128
 * chars or an invalid date is a handler bug → plain Error (500).
 */
export function latestMarkerOf(
  handler: CompanionContractHandler,
  message: unknown,
): CompanionLatestMarker | null {
  const marker = handler.latestWins?.(message) ?? null;
  if (marker === null) return null;
  if (marker.key.length === 0 || marker.key.length > COMPANION_LATEST_KEY_MAX_CHARS) {
    throw new Error(`companion ${handler.contract}: latest-wins key length`);
  }
  if (Number.isNaN(marker.at.getTime())) {
    throw new Error(`companion ${handler.contract}: latest-wins date invalid`);
  }
  return marker;
}
