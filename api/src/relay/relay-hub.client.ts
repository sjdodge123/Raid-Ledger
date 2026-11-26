/**
 * ROK-1676 (RH-6, L5) — the relay hub v1 HTTP calls, as pure functions.
 *
 * Bodies are built from the contract request types (no usage stats) and
 * responses are parsed with the contract schemas. Nothing here throws:
 * every outcome is a {@link HubResult}.
 */
import {
  HUB_SCHEMA_VERSION,
  HubHeartbeatResponseSchema,
  HubRegisterResponseSchema,
  type HubHeartbeatRequest,
  type HubHeartbeatResponse,
  type HubRegisterRequest,
  type HubRegisterResponse,
} from '@raid-ledger/contract';
import type { ZodType } from 'zod';
import { errorMessage, relayHeaders } from './relay.helpers';

/** Every hub call gives up after this long (§4.4: boot never waits). */
const HUB_TIMEOUT_MS = 10_000;

/** Outcome of one hub call. `status` is set when the hub answered. */
export type HubResult<T> =
  { ok: true; data: T } | { ok: false; status?: number; reason: string };

type Sent = { ok: true; response: Response } | { ok: false; reason: string };

/** Send one request; a network error or timeout becomes a failed result. */
async function send(url: string, init: RequestInit): Promise<Sent> {
  try {
    const signal = AbortSignal.timeout(HUB_TIMEOUT_MS);
    return { ok: true, response: await fetch(url, { ...init, signal }) };
  } catch (error) {
    return { ok: false, reason: errorMessage(error) };
  }
}

/** Send, then parse a 2xx body with `schema`. */
async function call<T>(
  url: string,
  init: RequestInit,
  schema: ZodType<T>,
): Promise<HubResult<T>> {
  const sent = await send(url, init);
  if (!sent.ok) return sent;
  const { status } = sent.response;
  if (!sent.response.ok) return { ok: false, status, reason: `HTTP ${status}` };
  const json: unknown = await sent.response.json().catch(() => undefined);
  const parsed = schema.safeParse(json);
  if (!parsed.success) return { ok: false, status, reason: 'malformed' };
  return { ok: true, data: parsed.data };
}

/** `POST /api/v1/instances/register` — no bearer; the hub issues one. */
export function registerWithHub(
  hubUrl: string,
  instanceId: string,
  version: string,
): Promise<HubResult<HubRegisterResponse>> {
  const body: HubRegisterRequest = {
    instanceId,
    schemaVersion: HUB_SCHEMA_VERSION,
    version,
  };
  const init = {
    method: 'POST',
    headers: relayHeaders(null),
    body: JSON.stringify(body),
  };
  return call(
    `${hubUrl}/api/v1/instances/register`,
    init,
    HubRegisterResponseSchema,
  );
}

/** `POST /api/v1/instances/:id/heartbeat`. */
export function heartbeatHub(
  hubUrl: string,
  instanceId: string,
  token: string,
  version: string,
): Promise<HubResult<HubHeartbeatResponse>> {
  const body: HubHeartbeatRequest = {
    schemaVersion: HUB_SCHEMA_VERSION,
    version,
  };
  const url = `${hubUrl}/api/v1/instances/${instanceId}/heartbeat`;
  const init = {
    method: 'POST',
    headers: relayHeaders(token),
    body: JSON.stringify(body),
  };
  return call(url, init, HubHeartbeatResponseSchema);
}

/** `DELETE /api/v1/instances/:id` — best effort, body ignored. */
export async function disconnectFromHub(
  hubUrl: string,
  instanceId: string,
  token: string,
): Promise<HubResult<null>> {
  const url = `${hubUrl}/api/v1/instances/${instanceId}`;
  const sent = await send(url, {
    method: 'DELETE',
    headers: relayHeaders(token),
  });
  if (!sent.ok) return sent;
  const { status } = sent.response;
  return sent.response.ok
    ? { ok: true, data: null }
    : { ok: false, status, reason: `HTTP ${status}` };
}
