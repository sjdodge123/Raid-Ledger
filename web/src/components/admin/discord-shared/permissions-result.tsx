/**
 * The bot's permission check result (granted list, or the missing ones plus
 * the re-authorise invite link). Extracted from DiscordBotForm (ROK-1703) so
 * the setup wizard's 4e screen shows the same result.
 */
import { BotInviteLink } from '../discord-bot-invite-panel';

export type PermissionCheck = { name: string; granted: boolean };

/** Only the permissions the bot is missing, plus the URL that re-authorises them. */
function MissingPermissions({ permissions }: { permissions: PermissionCheck[] }) {
    return (
        <>
            <ul className="text-xs text-danger space-y-1 list-disc list-inside">
                {permissions.filter((p) => !p.granted).map((p) => (
                    <li key={p.name}>{p.name}</li>
                ))}
            </ul>
            <BotInviteLink />
        </>
    );
}

function GrantedPermissions({ permissions }: { permissions: PermissionCheck[] }) {
    return (
        <div className="space-y-1">
            {permissions.map((p) => (
                <div key={p.name} className="flex items-center gap-2 text-xs">
                    <span className="text-success">{'\u2713'}</span>
                    <span className="text-secondary">{p.name}</span>
                </div>
            ))}
        </div>
    );
}

export function PermissionsResult({ result }: { result: { allGranted: boolean; permissions: PermissionCheck[] } | null }) {
    if (!result) return null;
    return (
        <div data-testid="permissions-result" className={`mt-3 rounded-lg p-4 animate-[fadeIn_0.3s_ease-in] ${result.allGranted ? 'bg-success/10 border border-success/30' : 'bg-warning/10 border border-warning/30'}`}>
            <p className={`text-xs font-semibold mb-2 ${result.allGranted ? 'text-success' : 'text-warning'}`}>
                {result.allGranted ? '\u2713 All required permissions granted' : '\u26A0 Missing permissions \u2014 re-authorise the bot with the invite URL below'}
            </p>
            {result.allGranted
                ? <GrantedPermissions permissions={result.permissions} />
                : <MissingPermissions permissions={result.permissions} />}
        </div>
    );
}
