import { z } from 'zod';

/** Nest injection token for the validated {@link HubConfig}. */
export const HUB_CONFIG = Symbol('HUB_CONFIG');

const optionalText = z.string().optional();

const HubConfigSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().min(1).default('0.0.0.0'),
  NODE_ENV: z.enum(['production', 'development', 'test']).default('production'),
  HUB_DATA_DIR: z.string().min(1).default('/data'),
  DATABASE_URL: optionalText,
  SENTRY_DSN: optionalText,
  DISABLE_TELEMETRY: optionalText,
  APP_VERSION: optionalText,
  HUB_MIGRATIONS_FOLDER: optionalText,
});

type ParsedConfig = z.infer<typeof HubConfigSchema>;

export interface HubConfig {
  readonly port: number;
  readonly host: string;
  readonly nodeEnv: 'production' | 'development' | 'test';
  /** Root of the hub's volume; the DB password lives under `secrets/`. */
  readonly dataDir: string;
  readonly databaseUrl?: string;
  readonly sentryDsn?: string;
  readonly telemetryDisabled: boolean;
  readonly appVersion?: string;
  readonly migrationsFolder?: string;
}

/** Empty strings count as unset (`${VAR:-default}` semantics). */
function optionalKeys(d: ParsedConfig): Partial<HubConfig> {
  return {
    ...(d.DATABASE_URL ? { databaseUrl: d.DATABASE_URL } : {}),
    ...(d.SENTRY_DSN ? { sentryDsn: d.SENTRY_DSN } : {}),
    ...(d.APP_VERSION ? { appVersion: d.APP_VERSION } : {}),
    ...(d.HUB_MIGRATIONS_FOLDER
      ? { migrationsFolder: d.HUB_MIGRATIONS_FOLDER }
      : {}),
  };
}

/**
 * Validates the hub's environment. Pure: reads only `env`. An invalid value
 * throws ONE error naming every bad key; values are never echoed (DATABASE_URL
 * and SENTRY_DSN carry secrets).
 */
export function loadHubConfig(env: NodeJS.ProcessEnv): HubConfig {
  const parsed = HubConfigSchema.safeParse({
    ...env,
    HUB_DATA_DIR: env.HUB_DATA_DIR || undefined,
  });
  if (!parsed.success) {
    const keys = [
      ...new Set(parsed.error.issues.map((i) => String(i.path[0]))),
    ];
    throw new Error(`Invalid relay-hub config: ${keys.join(', ')}`);
  }
  const d = parsed.data;
  return {
    port: d.PORT,
    host: d.HOST,
    nodeEnv: d.NODE_ENV,
    dataDir: d.HUB_DATA_DIR,
    telemetryDisabled: d.DISABLE_TELEMETRY === 'true',
    ...optionalKeys(d),
  };
}
