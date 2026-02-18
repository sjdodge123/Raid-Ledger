import * as chrono from 'chrono-node';

export interface ParsedTime {
  date: Date;
  timezone: string;
  inputText: string;
}

/**
 * Parse a natural language time string into a Date.
 * Uses chrono-node for flexible parsing (e.g., "tonight 8pm", "Friday 7:30pm").
 *
 * @param input - Natural language time string
 * @param timezone - IANA timezone to use as reference (e.g., "America/New_York")
 * @returns Parsed time result or null if parsing fails
 */
export function parseNaturalTime(
  input: string,
  timezone?: string | null,
): ParsedTime | null {
  const refDate = new Date();
  const tz = timezone || 'UTC';

  const results = chrono.parse(input, { instant: refDate, timezone: tz }, { forwardDate: true });

  if (results.length === 0) {
    return null;
  }

  const result = results[0];
  const date = result.start.date();

  return {
    date,
    timezone: tz,
    inputText: input,
  };
}

/**
 * Format a Date for display in Discord embeds.
 * Uses Discord's timestamp format for localized display.
 *
 * @param date - Date to format
 * @returns Discord timestamp string (e.g., "<t:1234567890:F>")
 */
export function toDiscordTimestamp(
  date: Date,
  style: 'F' | 'f' | 'R' | 't' | 'T' | 'D' | 'd' = 'F',
): string {
  const epoch = Math.floor(date.getTime() / 1000);
  return `<t:${epoch}:${style}>`;
}
