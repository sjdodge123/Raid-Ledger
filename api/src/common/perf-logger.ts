import { Logger } from '@nestjs/common';

const perfLogger = new Logger('PERF');

/**
 * Check if performance logging is enabled (gated behind DEBUG=true).
 * Exported so callers can skip expensive argument construction.
 */
export function isPerfEnabled(): boolean {
  return process.env.DEBUG === 'true';
}

/**
 * Emit a structured performance log line.
 *
 * Format: `[PERF] <CATEGORY> | <operation> | <duration>ms | key=value key=value`
 *
 * Categories: HTTP, DB, CRON, QUEUE, DISCORD, WS, HEAP
 *
 * @param category - Grep-friendly category tag
 * @param operation - Short description of the operation
 * @param durationMs - Duration in milliseconds
 * @param meta - Optional key-value pairs for context
 */
export function perfLog(
  category: 'HTTP' | 'DB' | 'CRON' | 'QUEUE' | 'DISCORD' | 'WS' | 'HEAP',
  operation: string,
  durationMs: number,
  meta?: Record<string, string | number | null | undefined>,
): void {
  if (!isPerfEnabled()) return;

  let line = `[PERF] ${category} | ${operation} | ${Math.round(durationMs)}ms`;

  if (meta) {
    const pairs = Object.entries(meta)
      .filter(([, v]) => v != null)
      .map(([k, v]) => `${k}=${v}`)
      .join(' ');
    if (pairs) {
      line += ` | ${pairs}`;
    }
  }

  perfLogger.debug(line);
}
