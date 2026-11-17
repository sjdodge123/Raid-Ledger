/**
 * ROK-2208 — plain-words copy for the bind (PUT) error codes and the bot's
 * permission names. A reserved own-forum name belongs on the name field;
 * every other refusal shows in the form's alert line.
 */
import { HUB_FORUM_DISCORD_DEFAULT_CHANNEL_NAME, HUB_FORUM_DISCORD_TAG_LIMIT } from '@raid-ledger/contract';
import { errorBodyOf } from '../../../lib/api/api-error';

/** "ManageWebhooks" → "Manage Webhooks"; already-spaced labels pass through. */
export function permissionLabel(permission: string): string {
    return permission.replace(/([a-z])([A-Z])/g, '$1 $2');
}

/** "Manage Webhooks, Manage Threads". */
export function permissionList(permissions: readonly string[]): string {
    return permissions.map(permissionLabel).join(', ');
}

function errorCode(error: unknown): string | undefined {
    const code = errorBodyOf(error)?.code;
    return typeof code === 'string' ? code : undefined;
}

/** The inline name-field error, or undefined when the error is not a reserved name. */
export function nameFieldError(error: unknown): string | undefined {
    if (errorCode(error) !== 'FORUM_DISCORD_NAME_RESERVED') return undefined;
    return `#${HUB_FORUM_DISCORD_DEFAULT_CHANNEL_NAME} is the shared forum. Pick another name for this hub’s own forum.`;
}

function missingList(error: unknown): string {
    const missing = errorBodyOf(error)?.missing;
    return Array.isArray(missing) ? permissionList(missing.filter((m): m is string => typeof m === 'string')) : '';
}

/** The form's alert line for a refused bind; null when the name field shows it. */
export function bindErrorMessage(error: Error): string | null {
    switch (errorCode(error)) {
        case 'FORUM_DISCORD_NAME_RESERVED': return null;
        case 'FORUM_DISCORD_CHANNEL_PRIVATE':
            return 'This forum is private in Discord. Raid Ledger only syncs forums everyone in the server can see.';
        case 'FORUM_DISCORD_TAG_LIMIT':
            return `That Discord forum already carries the maximum of ${String(HUB_FORUM_DISCORD_TAG_LIMIT)} tags. Pick this hub’s own channel instead.`;
        case 'FORUM_DISCORD_MISSING_PERMS': {
            const list = missingList(error);
            return `The bot is missing ${list || 'a permission'} on Discord. Give it ${list ? 'those permissions' : 'the permission'}, then try again.`;
        }
        case 'DISCORD_BOT_OFFLINE': return 'The Discord bot is offline. Try again once it’s back.';
        default: return error.message || 'Couldn’t turn on sync. Try again.';
    }
}
