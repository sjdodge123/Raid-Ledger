/** Timestamped log lines `from`..`to` (~80 bytes each). */
export function logLines(from: number, to: number): string {
  let out = '';
  for (let i = from; i <= to; i++) {
    const ts = new Date(Date.UTC(2026, 8, 23, 9, 2, i)).toISOString();
    out += `${ts} INFO [Http] GET /api/events/${i} 200 - request handled\n`;
  }
  return out;
}
