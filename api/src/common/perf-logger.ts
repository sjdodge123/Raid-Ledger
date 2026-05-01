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
 * Format a duration in ms for log output.
 *
 * - `< 0`         → `0ms` (clamp negative)
 * - `< 1ms`       → two decimals (e.g. `0.42ms`) so sub-ms queries differ from 0
 * - `>= 1ms`      → integer ms (e.g. `6ms`, `129ms`)
 *
 * Sub-ms precision is kept only below 1ms because indexed Drizzle reads
 * commonly take 0.1–0.9ms and would otherwise floor to `0ms` and lose signal.
 */
export function formatDurationMs(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return '0ms';
  if (durationMs < 1)
    return `${(Math.round(durationMs * 100) / 100).toFixed(2)}ms`;
  return `${Math.round(durationMs)}ms`;
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

  let line = `[PERF] ${category} | ${operation} | ${formatDurationMs(durationMs)}`;

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
