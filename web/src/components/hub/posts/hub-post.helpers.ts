/**
 * ROK-1868 — pure helpers for hub leader posts: the edited marker, the byline
 * meta line, the composer's relay hint + outcome notice and the composer's
 * pre-submit body check (§3.3). The deep-link helpers live in `post-link.ts`.
 */
import {
    findHubPostMarkdownViolation, HUB_POST_BODY_MAX, HUB_POST_MARKDOWN_MESSAGES,
    type GuildKind, type HubPost, type HubPostRelayChannel, type HubPostRelayOutcome,
} from '@raid-ledger/contract';
import { errorBodyOf } from '../../../lib/api/api-error';
import { updatedLabel } from '../content/guild-content.helpers';

/** D20 — the editor counts markdown SOURCE characters. */
export const BODY_TOO_LONG = `Too long — formatting counts toward the ${HUB_POST_BODY_MAX} characters.`;

export interface PostNotice { tone: 'success' | 'warning' | 'muted'; text: string }

/** D4 — only a PATCH sets `editedBy`, so backfilled and fresh posts never read as edited. */
export function isEdited(post: HubPost): boolean {
    return post.editedBy !== null;
}

/** "Posted 3 Oct 2026" + " · Edited 4 Oct 2026 by Kara" when edited. */
export function postMeta(post: HubPost): string {
    const posted = `Posted ${updatedLabel(post.createdAt)}`;
    if (!post.editedBy) return posted;
    const by = post.editedBy.displayName ?? 'a former member';
    return `${posted} · Edited ${updatedLabel(post.updatedAt)} by ${by}`;
}

const LEADER: Record<GuildKind, { title: string; settings: string }> = {
    wow_guild: { title: 'guild master', settings: 'Guild settings' },
    game_server: { title: 'server leader', settings: 'Server settings' },
};

function unsetHint(kind: GuildKind | undefined, isLeader: boolean): string {
    const leader = LEADER[kind ?? 'wow_guild'];
    return isLeader
        ? `Link a Discord channel in ${leader.settings} to post there.`
        : `Your ${leader.title} can link a Discord channel in ${leader.settings}.`;
}

/** The "Also post to Discord" helper line per channel state (W1/W1b). */
export function relayHint(channel: HubPostRelayChannel, kind: GuildKind | undefined, isLeader: boolean): PostNotice {
    switch (channel.state) {
        case 'ok': return { tone: 'muted', text: `Posts to #${channel.channelName}. Edits stay on Raid Ledger.` };
        case 'unset': return { tone: 'warning', text: unsetHint(kind, isLeader) };
        case 'no-permission': {
            const where = channel.channelName ? `#${channel.channelName}` : 'the linked channel';
            return { tone: 'warning', text: `The bot can't post in ${where}. Give it Send Messages and Embed Links.` };
        }
        case 'gone': return { tone: 'warning', text: 'The linked channel no longer exists.' };
        case 'disconnected': return { tone: 'warning', text: 'Discord is offline right now.' };
    }
}

/** D7 — what the author is told after POST; null when no relay was asked for. */
export function relayOutcomeNotice(outcome: HubPostRelayOutcome, channelName: string | null): PostNotice | null {
    const where = channelName ? `#${channelName}` : 'Discord';
    switch (outcome) {
        case 'sent': return { tone: 'success', text: `Posted. It’s in ${where} on Discord too.` };
        case 'failed': return { tone: 'warning', text: 'Posted here, but it couldn’t be sent to Discord. The post is saved on this page.' };
        case 'unavailable': return { tone: 'warning', text: 'Posted here only — Discord isn’t available for this hub right now.' };
        case 'not_requested': return null;
    }
}

/** Pre-submit check — the contract's subset message, the D20 length message, or null. */
export function bodyError(markdown: string): string | null {
    const violation = findHubPostMarkdownViolation(markdown);
    if (violation) return HUB_POST_MARKDOWN_MESSAGES[violation];
    return markdown.length > HUB_POST_BODY_MAX ? BODY_TOO_LONG : null;
}

function firstString(value: unknown): string | null {
    if (typeof value === 'string') return value;
    return Array.isArray(value) && typeof value[0] === 'string' ? value[0] : null;
}

/** The first `body` message of a 400 payload (`fieldErrors.body`, `errors.body` or `body`). */
export function serverBodyError(error: unknown): string | null {
    const payload = errorBodyOf(error);
    if (!payload) return null;
    for (const bag of [payload['fieldErrors'], payload['errors'], payload]) {
        if (bag && typeof bag === 'object') {
            const hit = firstString((bag as Record<string, unknown>)['body']);
            if (hit) return hit;
        }
    }
    return null;
}
