/**
 * Provider availability resolution (ROK-1148 item 2).
 *
 * Extracted from `AiProvidersController`, which had grown to own provider
 * listing, configuration, activation, Ollama setup proxying AND availability
 * resolution. These three are pure functions over a probe callback, so they
 * test in isolation without standing up the controller and its five
 * injected services.
 */
import { AI_DEFAULTS } from './llm.constants';
import { deriveAvailability } from './ai-admin.helpers';

/** How long a live probe may hang before it is treated as unavailable. */
const PROBE_TIMEOUT_MS = 2000;

/** The slice of a provider these helpers need. */
export interface AvailabilityTarget {
  key: string;
  isAvailable: () => Promise<boolean>;
}

export interface AvailabilityResult {
  available: boolean;
  error?: string;
}

/**
 * Turn a raw provider error into something an operator can act on.
 *
 * Ordering matters: quota/billing phrasing is checked before the generic
 * `invalid` match, because several providers put "invalid" in a message whose
 * real cause is billing.
 */
export function extractFriendlyError(msg: string): string {
  if (msg.includes('credit balance')) return 'Account has insufficient credits';
  if (msg.includes('insufficient_quota'))
    return 'Account has insufficient quota';
  if (msg.includes('billing')) return 'Billing issue — check your account';
  if (msg.includes('API_KEY_INVALID') || msg.includes('invalid'))
    return 'Invalid API key';
  if (msg.includes('authentication') || msg.includes('401'))
    return 'Invalid API key';
  if (msg.includes('403') || msg.includes('PERMISSION_DENIED'))
    return 'API key lacks permissions';
  if (msg.includes('429')) return 'Rate limited — try again later';
  return 'Provider unreachable';
}

/** Probe availability with a timeout, capturing error details. */
export async function checkAvailableWithError(
  provider: AvailabilityTarget,
): Promise<AvailabilityResult> {
  try {
    const available = await Promise.race([
      provider.isAvailable(),
      new Promise<false>((r) => setTimeout(() => r(false), PROBE_TIMEOUT_MS)),
    ]);
    return { available };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { available: false, error: extractFriendlyError(msg) };
  }
}

/**
 * Active provider: heartbeat-first availability (ROK-1138). If a recent
 * successful chat is logged we skip the live probe (and there is no error to
 * surface). Otherwise — and for non-active providers — fall back to the probe
 * path so error messaging stays intact.
 */
export async function resolveAvailability(
  provider: AvailabilityTarget,
  isActive: boolean,
  getLastSuccessfulChatAt: (providerKey: string) => Promise<Date | null>,
): Promise<AvailabilityResult> {
  if (!isActive) return checkAvailableWithError(provider);

  let probeResult: AvailabilityResult | null = null;
  const available = await deriveAvailability({
    providerKey: provider.key,
    lastSuccessAt: await getLastSuccessfulChatAt(provider.key),
    probe: async () => {
      probeResult = await checkAvailableWithError(provider);
      return probeResult.available;
    },
    now: new Date(),
    freshnessMs: AI_DEFAULTS.availabilityFreshnessMs,
  });

  // A probe that ran carries the error detail; the heartbeat path has none.
  if (probeResult) return probeResult;
  return { available };
}
