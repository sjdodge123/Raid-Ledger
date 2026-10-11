import { refreshWithOutcome, type RefreshOutcome } from './refresh-client';
import { legacySessionPurged } from './access-token-store';
import { getAuthMethod, setAuthMethod } from './silent-reauth';
import { awaitMagicLinkRedeem, isMagicLinkRedeemPending } from '../magic-link-redeem';

/**
 * ROK-1754 §3.2: the access token lives in memory, so a page load starts with
 * none. A prior sign-in (the auth-method marker, or a legacy stored token this
 * load just purged) re-mints it from the httpOnly refresh cookie BEFORE the app
 * renders — StartupGate waits for this — so every `enabled: !!getAuthToken()`
 * query sees the token on first render. The POST is the same single flight as
 * the magic-link probe. An anonymous visitor makes no request (ROK-1353).
 */
export type BootOutcome = RefreshOutcome['kind'] | 'anonymous';

/** A hung refresh must not hold the app behind the gate forever (§3.2: indeterminate renders). */
export const BOOT_TIMEOUT_MS = 10_000;

/** Routes that exchange their own credential: no boot refresh, no gate (review m3). */
export const BOOT_BYPASS_PATHS = ['/auth/success'];

function onBypassPath(): boolean {
  return typeof window !== 'undefined' && BOOT_BYPASS_PATHS.includes(window.location.pathname);
}

let boot: Promise<BootOutcome> | null = null;
let settled = false;
const listeners = new Set<() => void>();

function settle(outcome: BootOutcome): BootOutcome {
  settled = true;
  listeners.forEach((fn) => fn());
  return outcome;
}

async function mintFromCookie(): Promise<BootOutcome> {
  const hasSession = getAuthMethod() !== null || legacySessionPurged();
  const refresh = hasSession
    ? refreshWithOutcome().then((o) => o.kind, (): BootOutcome => 'indeterminate')
    : Promise.resolve<BootOutcome>('anonymous');
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<BootOutcome>((resolve) => {
    timer = setTimeout(() => resolve('indeterminate'), BOOT_TIMEOUT_MS);
  });
  const outcome = await Promise.race([refresh, timeout]);
  // A deep magic link lands signed in on first render (its redeem shares the flight).
  if (isMagicLinkRedeemPending()) await Promise.race([awaitMagicLinkRedeem(), timeout]);
  clearTimeout(timer);
  // A purged legacy session that re-minted has no marker: write one, or the
  // NEXT load boots anonymous and REST 401s never refresh (review m2). 'local'
  // is inert for silent re-auth, which only acts on 'discord'.
  if (outcome === 'ok' && getAuthMethod() === null && legacySessionPurged()) setAuthMethod('local');
  return outcome;
}

/** Idempotent. Called once at module load from App.tsx, after the magic-link start. */
export function startBootSession(): Promise<BootOutcome> {
  if (boot) return boot;
  const nothingToMint = !getAuthMethod() && !legacySessionPurged() && !isMagicLinkRedeemPending();
  if (nothingToMint || onBypassPath()) {
    boot = Promise.resolve(settle('anonymous'));
  } else {
    boot = mintFromCookie().then(settle);
  }
  return boot;
}

/** The boot outcome; resolves immediately when no boot was started. */
export function awaitBootSession(): Promise<BootOutcome> {
  return boot ?? Promise.resolve('anonymous');
}

/** True once the boot settled (any outcome) — or when none was started: nothing to wait for. */
export function isBootSettled(): boolean {
  return boot === null || settled;
}

/** For `useSyncExternalStore` in StartupGate. */
export function subscribeBootSession(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
