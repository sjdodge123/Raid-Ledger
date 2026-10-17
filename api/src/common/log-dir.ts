import * as os from 'node:os';
import * as path from 'node:path';
import type { ConfigService } from '@nestjs/config';

/**
 * Production default: Docker volume-mounted, writable by the `app` user inside
 * the allinone image. Survives container recreation.
 */
const PRODUCTION_DEFAULT = '/data/logs';

/**
 * Resolve the directory used for application log files (ROK-1266).
 *
 * Order of precedence:
 *   1. `LOG_DIR` env var (CI sets `/tmp/raid-ledger-logs`; ops may override).
 *   2. `/data/logs` when `NODE_ENV=production` (allinone Docker volume).
 *   3. `<os.tmpdir()>/raid-ledger-logs` in dev/test.
 *
 * The dev fallback exists because the previous default (`/data/logs`) was
 * unwritable on local Macs and the seed endpoint silently swallowed the
 * `mkdir` failure, leaving the admin Logs panel listing endpoint reading from
 * an empty / nonexistent path. Both the listing endpoint
 * (`LogsService.listLogFiles`) and the writers (`SlowQueriesService.appendDigestToLog`,
 * the hourly cron) MUST resolve to the same directory or the listing won't
 * see what was written.
 */
export function resolveLogDir(configService: ConfigService): string {
  const configured = configService.get<string>('LOG_DIR');
  if (configured && configured.length > 0) return configured;
  if (process.env.NODE_ENV === 'production') return PRODUCTION_DEFAULT;
  return path.join(os.tmpdir(), 'raid-ledger-logs');
}
