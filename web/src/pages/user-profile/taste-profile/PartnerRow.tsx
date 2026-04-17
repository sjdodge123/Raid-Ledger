import type { JSX } from "react";
import { Link } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import type { CoPlayPartnerDto } from "@raid-ledger/contract";
import { resolveAvatar, toAvatarUser } from "../../../lib/avatar";

interface PartnerRowProps {
    partner: CoPlayPartnerDto;
}

function PartnerAvatar({
    url,
    username,
}: {
    url: string | null;
    username: string;
}): JSX.Element {
    if (url) {
        return (
            <img
                src={url}
                alt=""
                className="partner-row__avatar"
                onError={(e) => {
                    e.currentTarget.style.display = "none";
                }}
            />
        );
    }
    return (
        <span className="partner-row__avatar partner-row__avatar--initials">
            {username.charAt(0).toUpperCase()}
        </span>
    );
}

function formatPartnerMeta(partner: CoPlayPartnerDto): string {
    const lastPlayed = formatDistanceToNow(new Date(partner.lastPlayedAt), {
        addSuffix: true,
    });
    const sessionLabel = partner.sessionCount === 1 ? "session" : "sessions";
    return `${partner.sessionCount} ${sessionLabel} · last ${lastPlayed}`;
}

/**
 * One row of the "Frequently plays with" list: avatar + username link +
 * meta line showing session count and relative last-play time.
 */
export function PartnerRow({ partner }: PartnerRowProps): JSX.Element {
    const avatar = resolveAvatar(
        toAvatarUser({ id: partner.userId, avatar: partner.avatar }),
    );
    return (
        <Link
            to={`/users/${partner.userId}`}
            className="partner-row"
            title={`View ${partner.username}'s profile`}
        >
            <PartnerAvatar url={avatar.url} username={partner.username} />
            <span className="partner-row__body">
                <span className="partner-row__name">{partner.username}</span>
                <span className="partner-row__meta">
                    {formatPartnerMeta(partner)}
                </span>
            </span>
        </Link>
    );
}
