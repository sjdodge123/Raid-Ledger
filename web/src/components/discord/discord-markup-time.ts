/**
 * ROK-1878 — Discord's `<t:UNIX:STYLE>` timestamp tokens, formatted in the
 * VIEWER's locale and time zone with Discord's own style meanings.
 */
import { formatDistanceToNow } from 'date-fns';

/** Discord's timestamp styles: short/long time, short/long date, short/long date-time, relative. */
export type DiscordTimestampStyle = 't' | 'T' | 'd' | 'D' | 'f' | 'F' | 'R';

const STYLE_OPTIONS: Record<Exclude<DiscordTimestampStyle, 'R'>, Intl.DateTimeFormatOptions> = {
    t: { timeStyle: 'short' },
    T: { timeStyle: 'medium' },
    d: { year: 'numeric', month: '2-digit', day: '2-digit' },
    D: { dateStyle: 'long' },
    f: { dateStyle: 'long', timeStyle: 'short' },
    F: { dateStyle: 'full', timeStyle: 'short' },
};

const STYLES: readonly DiscordTimestampStyle[] = ['t', 'T', 'd', 'D', 'f', 'F', 'R'];

function isTimestampStyle(raw: string): raw is DiscordTimestampStyle {
    return STYLES.some((style) => style === raw);
}

/** Narrows a captured style letter; `undefined` means Discord's default, `f`. */
export function toTimestampStyle(raw: string | undefined): DiscordTimestampStyle | null {
    if (raw === undefined) return 'f';
    return isTimestampStyle(raw) ? raw : null;
}

/** The Date for a unix-seconds value, or null when it is not a representable instant. */
export function discordTimestampDate(unix: number): Date | null {
    if (!Number.isFinite(unix)) return null;
    const date = new Date(unix * 1000);
    return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Formats a Discord timestamp the way Discord shows it to this viewer.
 *
 * @param unix seconds since the epoch, as written in the token
 * @param style the token's style letter (`R` is relative, e.g. "in 2 days")
 * @returns the display string, or null for an invalid instant (caller keeps the literal)
 */
export function formatDiscordTimestamp(unix: number, style: DiscordTimestampStyle): string | null {
    const date = discordTimestampDate(unix);
    if (date === null) return null;
    if (style === 'R') return formatDistanceToNow(date, { addSuffix: true });
    return new Intl.DateTimeFormat(undefined, STYLE_OPTIONS[style]).format(date);
}
