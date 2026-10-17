import { useServerInvite } from '../../hooks/use-discord-onboarding';
import { DiscordIcon } from '../icons/DiscordIcon';

/**
 * FTE Wizard Step: Join Discord Server (ROK-403).
 * Shows a "Join Server" button with a generated invite link.
 * Skippable — users can proceed without joining.
 */
function DiscordJoinHeader({ guildName }: { guildName: string }) {
    return (
        <div className="text-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-[#5865F2]/20 flex items-center justify-center">
                <DiscordIcon className="w-8 h-8 text-[#5865F2]" />
            </div>
            <h2 className="text-2xl font-bold text-foreground">Join {guildName}</h2>
            <p className="text-muted mt-2">Join the community Discord server to get event notifications, find groups, and stay connected.</p>
        </div>
    );
}

function JoinServerContent({ isLoading, invite }: { isLoading: boolean; invite: { url?: string | null; guildName?: string | null } | undefined }) {
    if (isLoading) return <div className="flex items-center justify-center py-4"><span className="w-5 h-5 border-2 border-[#5865F2]/30 border-t-[#5865F2] rounded-full animate-spin" /></div>;
    if (invite?.url) {
        return (
            <a href={invite.url} target="_blank" rel="noopener noreferrer"
                className="w-full py-3 px-4 min-h-[44px] bg-[#5865F2] hover:bg-[#4752C4] text-white font-semibold rounded-lg transition-colors flex items-center justify-center gap-3">
                <DiscordIcon className="w-5 h-5" />Join Server
            </a>
        );
    }
    return <div className="text-center text-muted text-sm py-4">Discord server invite is not available right now.<br />You can skip this step and join later.</div>;
}

export function DiscordJoinStep() {
    const { data: invite, isLoading } = useServerInvite();
    const guildName = invite?.guildName || 'our Discord server';

    return (
        <div className="space-y-6">
            <DiscordJoinHeader guildName={guildName} />
            <div className="max-w-sm mx-auto space-y-3">
                <JoinServerContent isLoading={isLoading} invite={invite} />
                <p className="text-xs text-dim text-center mt-2">You can always join the server later from your profile or the community page.</p>
            </div>
        </div>
    );
}
