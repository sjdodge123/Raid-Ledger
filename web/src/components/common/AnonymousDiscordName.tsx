/**
 * AnonymousDiscordName — the name of a Discord user who signed up without a
 * Raid Ledger account (ROK-1694). There is no member row behind it (the API
 * sends user id 0), so it is plain text plus a "via Discord" chip — never a
 * link to a profile.
 */

/** The chip's raw-hue classes are repainted for the six light schemes in index.css. */
export const VIA_DISCORD_CHIP_CLASS = 'text-xs text-indigo-400 bg-indigo-500/10 px-1.5 py-0.5 rounded';

export function ViaDiscordChip() {
    return <span className={VIA_DISCORD_CHIP_CLASS}>via Discord</span>;
}

interface AnonymousDiscordNameProps {
    name: string;
    /** Wrapper classes (layout + base text colour). */
    className?: string;
    /** Classes for the name itself, e.g. `truncate font-medium` in a player card. */
    nameClassName?: string;
}

export function AnonymousDiscordName({
    name,
    className = 'flex items-center gap-1.5 text-sm text-muted',
    nameClassName,
}: AnonymousDiscordNameProps) {
    return (
        <span className={className}>
            <span className={nameClassName} title={name}>{name}</span>
            <ViaDiscordChip />
        </span>
    );
}
