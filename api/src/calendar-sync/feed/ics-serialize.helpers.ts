/**
 * ROK-1596 E1: a small, generic RFC 5545 (iCalendar) writer. Used by the
 * one-event `GET /events/:id/ics` download; ROK-1599's subscription feed
 * reuses it with many events — keep it free of Raid Ledger specifics.
 *
 * - Lines end in CRLF (§3.1).
 * - Content lines longer than 75 OCTETS are folded: CRLF + one space, never
 *   splitting a multi-byte UTF-8 character (§3.1).
 * - TEXT values escape `\` `;` `,` and newlines (§3.3.11).
 * - Date-times are UTC form `YYYYMMDDTHHMMSSZ` (§3.3.5, FORM #2).
 */

export interface IcsEvent {
  /** Globally unique and STABLE across exports (§3.8.4.7). */
  uid: string;
  start: Date;
  end: Date;
  summary: string;
  /** When the export was produced (DTSTAMP is REQUIRED, §3.8.7.2). */
  stamp: Date;
  description?: string;
  url?: string;
  status?: 'CONFIRMED' | 'TENTATIVE' | 'CANCELLED';
  /** Revision number; must grow with each significant change (§3.8.7.4). */
  sequence?: number;
  /** When the source object last changed (§3.8.7.3). */
  lastModified?: Date;
  /** Busy (`OPAQUE`, the default) or Free (`TRANSPARENT`) (§3.8.2.7). */
  transparency?: 'OPAQUE' | 'TRANSPARENT';
}

export interface IcsCalendar {
  /** e.g. `-//Raid Ledger//Events//EN` (§3.7.3). */
  prodId: string;
  events: IcsEvent[];
  /** Optional display name (`X-WR-CALNAME`, widely honoured). */
  name?: string;
  /**
   * Suggested poll interval as an ISO 8601 duration (e.g. `PT1H`), emitted
   * as `REFRESH-INTERVAL` (RFC 7986 §5.7) and `X-PUBLISHED-TTL` (Outlook).
   */
  refreshInterval?: string;
}

const CRLF = '\r\n';
const MAX_OCTETS = 75;

/** `2026-10-11T18:05:09.123Z` → `20261011T180509Z`. */
export function formatIcsUtc(date: Date): string {
  return date
    .toISOString()
    .replace(/\.\d{3}Z$/, 'Z')
    .replace(/[-:]/g, '');
}

/** Escape a TEXT value: `\` → `\\`, `;` → `\;`, `,` → `\,`, newline → `\n`. */
export function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

/**
 * Fold one content line to ≤75 octets per physical line. Continuation lines
 * start with a single space, which counts toward their 75 octets.
 */
export function foldIcsLine(line: string): string {
  const parts: string[] = [];
  let current = '';
  let octets = 0;
  for (const ch of line) {
    const size = Buffer.byteLength(ch, 'utf8');
    if (octets + size > MAX_OCTETS) {
      parts.push(current);
      current = ' ';
      octets = 1;
    }
    current += ch;
    octets += size;
  }
  parts.push(current);
  return parts.join(CRLF);
}

function eventLines(event: IcsEvent): string[] {
  const lines = [
    'BEGIN:VEVENT',
    `UID:${escapeIcsText(event.uid)}`,
    `DTSTAMP:${formatIcsUtc(event.stamp)}`,
    `DTSTART:${formatIcsUtc(event.start)}`,
    `DTEND:${formatIcsUtc(event.end)}`,
    `SUMMARY:${escapeIcsText(event.summary)}`,
  ];
  if (event.description !== undefined) {
    lines.push(`DESCRIPTION:${escapeIcsText(event.description)}`);
  }
  // URL is a URI value (§3.8.4.6) — not TEXT, so not escaped.
  if (event.url !== undefined) lines.push(`URL:${event.url}`);
  if (event.status !== undefined) lines.push(`STATUS:${event.status}`);
  if (event.transparency !== undefined) {
    lines.push(`TRANSP:${event.transparency}`);
  }
  if (event.sequence !== undefined) lines.push(`SEQUENCE:${event.sequence}`);
  if (event.lastModified !== undefined) {
    lines.push(`LAST-MODIFIED:${formatIcsUtc(event.lastModified)}`);
  }
  lines.push('END:VEVENT');
  return lines;
}

/** Serialize a whole VCALENDAR; the result ends with a trailing CRLF. */
export function serializeIcsCalendar(calendar: IcsCalendar): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${calendar.prodId}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ];
  if (calendar.name !== undefined) {
    lines.push(`X-WR-CALNAME:${escapeIcsText(calendar.name)}`);
  }
  if (calendar.refreshInterval !== undefined) {
    lines.push(`REFRESH-INTERVAL;VALUE=DURATION:${calendar.refreshInterval}`);
    lines.push(`X-PUBLISHED-TTL:${calendar.refreshInterval}`);
  }
  for (const event of calendar.events) lines.push(...eventLines(event));
  lines.push('END:VCALENDAR');
  return lines.map(foldIcsLine).join(CRLF) + CRLF;
}
