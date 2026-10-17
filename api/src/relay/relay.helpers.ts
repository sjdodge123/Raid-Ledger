/**
 * Pure helper functions for relay service.
 */
import type { RelayStatus } from './relay.service';

/** Build a connected relay status. */
export function connectedStatus(
  relayUrl: string,
  instanceId: string,
): RelayStatus {
  return { enabled: true, relayUrl, instanceId, connected: true };
}

/** Build an error relay status. */
export function errorStatus(
  relayUrl: string,
  instanceId: string,
  error: string,
): RelayStatus {
  return { enabled: true, relayUrl, instanceId, connected: false, error };
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
