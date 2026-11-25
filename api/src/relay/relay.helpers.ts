/**
 * Pure helper functions for relay service.
 */
import type { HubTrustTier } from '@raid-ledger/contract';
import type { RelayStatus } from './relay.service';

/** The trust-tier fields of a status (L7: `reader` = pending approval). */
export function tierFields(
  trustTier: HubTrustTier,
): Pick<RelayStatus, 'trustTier' | 'pendingApproval'> {
  return { trustTier, pendingApproval: trustTier === 'reader' };
}

/** Build a connected relay status. */
export function connectedStatus(
  relayUrl: string,
  instanceId: string,
  trustTier: HubTrustTier,
): RelayStatus {
  return {
    enabled: true,
    relayUrl,
    instanceId,
    connected: true,
    ...tierFields(trustTier),
  };
}

/** Build an error relay status; `enabled` is the stored flag, unchanged. */
export function errorStatus(
  relayUrl: string,
  instanceId: string,
  error: string,
  enabled: boolean,
): RelayStatus {
  return { enabled, relayUrl, instanceId, connected: false, error };
}

/** Extract error message from unknown error. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}

/** Build standard relay request headers. */
export function relayHeaders(token: string | null): Record<string, string> {
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    'Content-Type': 'application/json',
  };
}

/** Admin-facing message for a failed registration result. */
export function registrationError(failure: {
  status?: number;
  reason: string;
}): string {
  if (failure.status === undefined) {
    return `Could not reach relay: ${failure.reason}`;
  }
  if (failure.reason === 'malformed') {
    return 'Registration failed: malformed hub response';
  }
  return `Registration failed: HTTP ${failure.status}`;
}
