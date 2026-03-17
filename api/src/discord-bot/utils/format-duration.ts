/** Format a millisecond duration as a compact human-readable string (e.g. "3h", "2h 30m", "45m"). */
export function formatDurationMs(ms: number): string {
  if (ms <= 0) return '0m';
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  return h > 0 ? `${h}h` : `${m}m`;
}
