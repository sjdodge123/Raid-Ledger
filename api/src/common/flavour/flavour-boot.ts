import { Logger } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { assertFlavourBootConfig, ignoredFleetEnvWarning } from './flavour';

/** Side effects the boot guard needs; injectable so the spec can observe them. */
export interface FlavourBootDeps {
  logger: Pick<Logger, 'log' | 'warn' | 'error'>;
  exit: (code: number) => never;
}

const defaultDeps: FlavourBootDeps = {
  logger: new Logger('Flavour'),
  exit: (code) => process.exit(code),
};

/**
 * ROK-1700 — run before `NestFactory.create`. A bad flavour config is
 * reported to Sentry (flushed, per the boot-script rule) and exits 1; a valid
 * one logs the flavour and, under cloud, warns once about ignored FLEET_* vars.
 */
export async function enforceFlavourBootGuards(
  env: NodeJS.ProcessEnv = process.env,
  deps: FlavourBootDeps = defaultDeps,
): Promise<void> {
  try {
    const flavour = assertFlavourBootConfig(env);
    deps.logger.log(`Runtime flavour: ${flavour}`);
    const warning = ignoredFleetEnvWarning(env);
    if (warning) deps.logger.warn(warning);
  } catch (error) {
    deps.logger.error(error instanceof Error ? error.message : String(error));
    Sentry.captureException(error);
    await Sentry.flush(2000);
    deps.exit(1);
  }
}
