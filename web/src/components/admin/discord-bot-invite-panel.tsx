/**
 * ROK-1471: bot invite panel.
 *
 * The required-permission list is rendered from the API response so the admin UI
 * can never drift from the permission set the bot actually asks for. Nothing here
 * hardcodes a permission name or a permission integer.
 */
import { toast } from '../../lib/toast';
import { useBotInviteInfo } from '../../hooks/admin/use-lfg-board-settings';

/** Why re-authorising is safe and why editing the portal app is not enough. */
export const INVITE_INSTALL_TIME_NOTE =
    "Discord grants a bot's permission set at install time. Editing the application in the " +
    'developer portal does not change an existing guild install; re-authorising with this URL ' +
    'updates the install in place without removing the bot or losing its channel bindings.';

const PENDING_CLIENT_ID_NOTE =
    'The invite URL appears here once the Discord application client ID is saved on this page.';

/** Copies the invite URL, reporting the outcome via toast. */
function copyInviteUrl(url: string): void {
    void navigator.clipboard
        .writeText(url)
        .then(() => toast.success('Invite URL copied to clipboard'))
        .catch(() => toast.error('Failed to copy the invite URL'));
}

/**
 * The invite URL as a new-tab anchor plus a copy button. Renders a hint instead
 * when no client id has been configured yet.
 */
export function BotInviteLink(): React.ReactElement {
    const { data } = useBotInviteInfo();
    if (!data?.url) {
        return <p className="text-xs text-secondary mt-2">{PENDING_CLIENT_ID_NOTE}</p>;
    }
    return (
        <div className="flex flex-wrap items-center gap-3 mt-2">
            <a href={data.url} target="_blank" rel="noopener noreferrer"
                className="text-xs underline text-blue-300 hover:text-blue-200 break-all">
                Invite URL
            </a>
            <button type="button" onClick={() => copyInviteUrl(data.url as string)}
                className="py-1 px-2 text-xs bg-blue-600 hover:bg-blue-500 text-foreground font-semibold rounded transition-colors">
                Copy invite URL
            </button>
        </div>
    );
}

/** The API-supplied permission names, rendered as a list. */
function RequiredPermissions({ permissions }: { permissions: string[] }): React.ReactElement | null {
    if (permissions.length === 0) return null;
    return (
        <ul className="text-xs text-secondary space-y-0.5 list-disc list-inside ml-2 mt-1">
            {permissions.map((name) => (
                <li key={name}>{name}</li>
            ))}
        </ul>
    );
}

/**
 * Full invite panel: required permissions, the invite URL + copy button, and the
 * install-time re-authorisation explanation.
 */
export function DiscordBotInvitePanel(): React.ReactElement {
    const { data } = useBotInviteInfo();
    return (
        <div className="mt-1" data-testid="bot-invite-panel">
            <p className="text-xs text-secondary ml-2">
                Open the invite URL below and pick your server. It already requests every
                permission this app needs:
            </p>
            <RequiredPermissions permissions={data?.permissions ?? []} />
            <BotInviteLink />
            <p className="text-xs text-dim mt-2">{INVITE_INSTALL_TIME_NOTE}</p>
        </div>
    );
}
