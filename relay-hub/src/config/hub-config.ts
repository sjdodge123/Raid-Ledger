import { z } from 'zod';

/** Nest injection token for the validated {@link HubConfig}. */
export const HUB_CONFIG = Symbol('HUB_CONFIG');

const HubConfigSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().min(1).default('0.0.0.0'),
  NODE_ENV: z.enum(['production', 'development', 'test']).default('production'),
});

export interface HubConfig {
  readonly port: number;
  readonly host: string;
  readonly nodeEnv: 'production' | 'development' | 'test';
}

/**
 * Validates the hub's environment. Pure: reads only `env`. An invalid value
 * throws ONE error naming every bad key; values are never echoed (an env var
 * may hold a secret in a later story).
 */
export function loadHubConfig(env: NodeJS.ProcessEnv): HubConfig {
  const parsed = HubConfigSchema.safeParse({
    PORT: env.PORT,
    HOST: env.HOST,
    NODE_ENV: env.NODE_ENV,
  });
  if (!parsed.success) {
    const keys = [
      ...new Set(parsed.error.issues.map((i) => String(i.path[0]))),
    ];
    throw new Error(`Invalid relay-hub config: ${keys.join(', ')}`);
  }
  const { PORT, HOST, NODE_ENV } = parsed.data;
  return { port: PORT, host: HOST, nodeEnv: NODE_ENV };
}
