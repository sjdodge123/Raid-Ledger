/**
 * Companion-bot login with one retry.
 *
 * The Discord gateway can take longer than the login timeout when the GitHub
 * runner queue is saturated (discord-smoke job 131854811413, 2026-11-13: "Bot
 * login timed out after 15s" after 154 tests had passed, so a whole batch never
 * ran). A second attempt on a fresh client clears that environmental stall; a
 * real failure (bad token, missing intents) fails both attempts and surfaces
 * the LAST error, so nothing hides behind the retry.
 */
export interface LoginAttemptOptions<T> {
  /** Builds a fresh client and resolves once it is ready. */
  attempt: () => Promise<T>;
  /** Tears down a client whose attempt failed, before the next one starts. */
  cleanup: () => Promise<void>;
  /** Total attempts, first one included. */
  attempts: number;
  log?: (msg: string) => void;
}

export async function loginWithRetry<T>(opts: LoginAttemptOptions<T>): Promise<T> {
  let lastErr: unknown = new Error('loginWithRetry: no attempts made');
  for (let i = 1; i <= opts.attempts; i++) {
    try {
      return await opts.attempt();
    } catch (err) {
      lastErr = err;
      try {
        await opts.cleanup();
      } catch (cleanupErr) {
        const m = cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr);
        opts.log?.(`[test-bot] Cleanup after failed login attempt ${i} threw (${m}); continuing`);
      }
      if (i < opts.attempts) {
        const msg = err instanceof Error ? err.message : String(err);
        opts.log?.(`[test-bot] Login attempt ${i}/${opts.attempts} failed (${msg}); retrying`);
      }
    }
  }
  throw lastErr;
}

/** Resolves when `ready` fires, rejects on login error or after `timeoutMs`. */
export function waitForReady(
  login: () => Promise<unknown>,
  onReady: (cb: () => void) => void,
  timeoutMs: number,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`Bot login timed out after ${timeoutMs / 1000}s`)),
      timeoutMs,
    );
    onReady(() => {
      clearTimeout(timeout);
      resolve();
    });
    login().catch((err: unknown) => {
      clearTimeout(timeout);
      reject(err instanceof Error ? err : new Error(String(err)));
    });
  });
}
