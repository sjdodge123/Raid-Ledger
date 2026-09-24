import { z } from 'zod';
import { HubCursorSchema } from './hub-envelope.schema.js';

/**
 * ROK-1667 (RH-1a) — relay hub v1 instance lifecycle: register and
 * heartbeat.
 *
 * The request schemas are deliberately NOT `.strict()`: today's client
 * (`api/src/relay/relay.service.ts`) spreads usage stats into both bodies,
 * and the hub drops them rather than rejecting the call. A missing
 * `schemaVersion` means 1. `enrollmentCode` stays optional in the contract
 * (D1: the M1 hub enforces it, from M5 an open reader tier may not).
 */

export const HubTrustTierSchema = z
  .enum(['reader', 'contributor', 'unknown'])
  .catch('unknown');

export type HubTrustTier = z.infer<typeof HubTrustTierSchema>;

/** Body of `POST /api/v1/instances/register`. */
export const HubRegisterRequestSchema = z.object({
  instanceId: z.uuid(),
  version: z.string().max(40),
  schemaVersion: z.number().int().positive().default(1),
  enrollmentCode: z.string().min(16).max(100).optional(),
});

export type HubRegisterRequest = z.infer<typeof HubRegisterRequestSchema>;

export const HubRegisterResponseSchema = z.object({
  token: z.string().startsWith('rlh_'),
  instanceId: z.uuid(),
  trustTier: HubTrustTierSchema,
  schemaVersion: z.number().int(),
  epoch: z.string(),
});

export type HubRegisterResponse = z.infer<typeof HubRegisterResponseSchema>;

/** Body of `POST /api/v1/instances/:id/heartbeat`. */
export const HubHeartbeatRequestSchema = z.object({
  version: z.string().max(40),
  schemaVersion: z.number().int().positive().default(1),
});

export type HubHeartbeatRequest = z.infer<typeof HubHeartbeatRequestSchema>;

export const HubHeartbeatResponseSchema = z.object({
  schemaVersion: z.number().int(),
  epoch: z.string(),
  serverTime: z.iso.datetime(),
  /** Feed cursors, from M2. */
  heads: z.record(z.string(), HubCursorSchema).optional(),
});

export type HubHeartbeatResponse = z.infer<typeof HubHeartbeatResponseSchema>;
