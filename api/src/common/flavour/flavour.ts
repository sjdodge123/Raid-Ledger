/**
 * ROK-1700 (D-4) — one image, a runtime flavour flag.
 *
 * `RL_FLAVOUR` selects how the instance behaves:
 *   - unset / empty / `nas` → the self-hosted NAS build, exactly as before;
 *   - `cloud`               → the hosted build: no DEMO_MODE, no fleet-only
 *                             env hooks, no Co-Optimus, no local Ollama setup.
 * Any other value is a deploy mistake and fails the boot (OQ-7b).
 *
 * Dependency-free on purpose: `api/scripts/bootstrap-admin.ts` (a pre-Nest
 * script) imports it too.
 */
export const FLAVOUR_ENV = 'RL_FLAVOUR';
export const FLAVOURS = ['nas', 'cloud'] as const;
export type Flavour = (typeof FLAVOURS)[number];

/** Fleet-only variables the api or bootstrap scripts read; ignored under cloud. */
export const CLOUD_IGNORED_FLEET_ENVS = [
  'FLEET_FIRST_DISCORD_LOGIN_ADMIN',
  'FLEET_ADMIN_DISCORD_ID',
] as const;

function isFlavour(value: string): value is Flavour {
  return (FLAVOURS as readonly string[]).includes(value);
}

/** The configured flavour. Throws on an unknown value (fail fast at boot). */
export function getFlavour(env: NodeJS.ProcessEnv = process.env): Flavour {
  const raw = (env[FLAVOUR_ENV] ?? '').trim();
  if (raw === '') return 'nas';
  if (isFlavour(raw)) return raw;
  throw new Error(
    `${FLAVOUR_ENV}="${raw}" is not a known flavour — allowed values: ${FLAVOURS.join(', ')} (unset means nas)`,
  );
}

export function isCloudFlavour(env: NodeJS.ProcessEnv = process.env): boolean {
  return getFlavour(env) === 'cloud';
}

/**
 * Boot-time checks: an unknown flavour and cloud + DEMO_MODE both refuse to
 * boot. Returns the flavour so the caller can log it.
 */
export function assertFlavourBootConfig(
  env: NodeJS.ProcessEnv = process.env,
): Flavour {
  const flavour = getFlavour(env);
  if (flavour === 'cloud' && env.DEMO_MODE === 'true') {
    throw new Error(
      `${FLAVOUR_ENV}=cloud cannot run with DEMO_MODE=true — DEMO_MODE exposes test fixtures and must never be set on a cloud instance. Unset DEMO_MODE or set ${FLAVOUR_ENV}=nas.`,
    );
  }
  return flavour;
}

/**
 * Under cloud, the ONE warning naming every fleet-only variable that is set
 * (and ignored). Null when there is nothing to warn about.
 */
export function ignoredFleetEnvWarning(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  if (!isCloudFlavour(env)) return null;
  const set = CLOUD_IGNORED_FLEET_ENVS.filter(
    (key) => (env[key] ?? '').trim() !== '',
  );
  if (set.length === 0) return null;
  return `${FLAVOUR_ENV}=cloud ignores fleet-only variables: ${set.join(', ')} — first Discord login is not promoted to admin and no fleet operator is bootstrapped.`;
}
