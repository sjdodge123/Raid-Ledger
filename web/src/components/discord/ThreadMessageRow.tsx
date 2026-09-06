/**
 * ROK-1483 — one mirrored Discord message.
 *
 * Read-only by construction: there is no handler here that can write anything,
 * and the folder-wide guard test (D15 / AC4) pins that the whole tree stays
 * that way. Author name, avatar and timestamp are the values frozen on the row
 * at post time (D8) — a rename three months later must not rewrite history.
 */
import { useMemo, useState, type JSX } from 'react';
import { formatDistanceToNow } from 'date-fns';
import type { ThreadMessageAttachmentDto, ThreadMessageDto } from '@raid-ledger/contract';
import { DiscordText } from './DiscordText';
import { isHttpUrl, tokenize } from './discord-markdown.helpers';

export interface ThreadMessageRowProps {
    /** One mirrored message, exactly as the API returned it. */
    message: ThreadMessageDto;
}

const AVATAR_CLASS = 'h-8 w-8 shrink-0 rounded-full';

/** `Alice Bee` → `AB`; falls back to `?` for an empty name. */
function initialsOf(displayName: string): string {
    const letters = displayName
        .split(/\s+/)
        .filter((part) => part.length > 0)
        .slice(0, 2)
        .map((part) => part[0]?.toUpperCase() ?? '');
    return letters.join('') || '?';
}

/**
 * Attachment urls are mirrored verbatim and Discord signs them, so they rot
 * after roughly a day (A11). The filename is the durable part — and a url whose
 * protocol is not allow-listed never becomes an anchor at all.
 */
function AttachmentLink({ attachment }: { attachment: ThreadMessageAttachmentDto }): JSX.Element {
    if (!isHttpUrl(attachment.url)) {
        return (
            <li data-testid="thread-message-attachment" className="text-xs text-muted">
                {attachment.name}
            </li>
        );
    }
    return (
        <li data-testid="thread-message-attachment">
            <a
                href={attachment.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-primary underline underline-offset-2"
            >
                {attachment.name}
            </a>
        </li>
    );
}

/** Avatar image with an initials fallback on a null url or a load failure. */
function Avatar({ url, displayName }: { url: string | null; displayName: string }): JSX.Element {
    const [failed, setFailed] = useState(false);
    if (url === null || failed) {
        return (
            <span
                data-testid="thread-message-initials"
                className={`${AVATAR_CLASS} flex items-center justify-center bg-overlay text-xs font-semibold text-muted`}
            >
                {initialsOf(displayName)}
            </span>
        );
    }
    return (
        <img
            data-testid="thread-message-avatar"
            src={url}
            alt=""
            className={AVATAR_CLASS}
            onError={() => setFailed(true)}
        />
    );
}

/** Author, relative time and the `(edited)` marker. */
function MessageMeta({ message }: ThreadMessageRowProps): JSX.Element {
    const relative = formatDistanceToNow(new Date(message.createdAt), { addSuffix: true });
    return (
        <div className="flex flex-wrap items-baseline gap-2">
            <span className="text-sm font-medium text-foreground">
                {message.author.displayName}
            </span>
            <time className="text-xs text-muted" dateTime={message.createdAt}>
                {relative}
            </time>
            {message.editedAt !== null && (
                <span data-testid="thread-message-edited" className="text-xs text-muted">
                    (edited)
                </span>
            )}
        </div>
    );
}

/**
 * Renders one message row: avatar, author, relative time, optional `(edited)`
 * marker, the safely tokenized body and any attachments.
 *
 * @param props the mirrored message to render
 */
export function ThreadMessageRow({ message }: ThreadMessageRowProps): JSX.Element {
    const tokens = useMemo(
        () => tokenize(message.content, message.mentions),
        [message.content, message.mentions],
    );
    return (
        <li data-testid="thread-message-row" className="flex gap-2 rounded-lg bg-overlay px-3 py-2">
            <Avatar url={message.author.avatarUrl} displayName={message.author.displayName} />
            <div className="min-w-0 flex-1">
                <MessageMeta message={message} />
                {message.content !== '' && <DiscordText tokens={tokens} />}
                {message.attachments.length > 0 && (
                    <ul className="mt-1 space-y-0.5">
                        {message.attachments.map((attachment) => (
                            <AttachmentLink key={attachment.url} attachment={attachment} />
                        ))}
                    </ul>
                )}
            </div>
        </li>
    );
}
