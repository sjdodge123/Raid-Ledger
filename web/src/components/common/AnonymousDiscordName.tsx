/**
 * AnonymousDiscordName — the name of a Discord user who signed up without a
 * Raid Ledger account (ROK-1694). There is no member row behind it (the API
 * sends user id 0), so it is plain text plus a "via Discord" chip and is not
 * interactive itself: roster list rows wrap it in the ROK-381 guest-profile
 * link (`lib/guest-profile-link.ts`), the same link roster slot cards build.
 */

interface AnonymousDiscordNameProps {
    name: string;
    /** Wrapper classes (layout + base text colour). */
    className?: string;
}

export function AnonymousDiscordName({
    name,
    className = 'flex items-center gap-1.5 text-sm text-muted',
}: AnonymousDiscordNameProps) {
    return (
        <span className={className}>
            <span title={name}>{name}</span>
            {/* Raw-hue chip classes are repainted for the six light schemes in index.css. */}
            <span className="text-xs text-indigo-400 bg-indigo-500/10 px-1.5 py-0.5 rounded">via Discord</span>
        </span>
    );
}
