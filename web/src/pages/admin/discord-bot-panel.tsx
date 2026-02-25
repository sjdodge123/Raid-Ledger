import { useAdminSettings } from '../../hooks/use-admin-settings';
import { useAuth } from '../../hooks/use-auth';
import { isDiscordLinked } from '../../lib/avatar';
import { API_BASE_URL } from '../../lib/config';
import { toast } from '../../lib/toast';
import { IntegrationCard } from '../../components/admin/IntegrationCard';
import { DiscordBotForm } from '../../components/admin/DiscordBotForm';

const DiscordBotIcon = (
    <div className="w-10 h-10 rounded-lg bg-[#5865F2] flex items-center justify-center">
        <svg className="w-6 h-6 text-foreground" viewBox="0 0 24 24" fill="currentColor">
            <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
        </svg>
    </div>
);

/**
 * Integrations > Discord Bot panel.
 * ROK-117: Wraps IntegrationCard + DiscordBotForm.
 * ROK-385: Hidden when admin has no linked Discord account.
 */
export function DiscordBotPanel() {
    const { discordBotStatus, adHocEventsStatus, updateAdHocEvents } = useAdminSettings();
    const { user } = useAuth();

    const hasDiscord = isDiscordLinked(user?.discordId);

    const handleLinkDiscord = () => {
        const token = localStorage.getItem('raid_ledger_token');
        if (!token) {
            toast.error('Please log in again to link Discord');
            return;
        }
        window.location.href = `${API_BASE_URL}/auth/discord/link?token=${encodeURIComponent(token)}`;
    };

    if (!hasDiscord) {
        return (
            <div className="space-y-6">
                <div>
                    <h2 className="text-xl font-semibold text-foreground">Discord Bot</h2>
                    <p className="text-sm text-muted mt-1">Enable Discord bot features for event reminders, notifications, and PUG invites.</p>
                </div>
                <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-6">
                    <div className="flex items-start gap-4">
                        {DiscordBotIcon}
                        <div className="flex-1">
                            <h3 className="text-base font-semibold text-foreground">Discord Account Required</h3>
                            <p className="text-sm text-muted mt-1">
                                You need to link a Discord account before configuring the bot.
                                Without a linked account, the bot cannot send you DMs or complete the setup wizard.
                            </p>
                            <button
                                onClick={handleLinkDiscord}
                                className="mt-4 inline-flex items-center gap-2 px-4 py-2.5 bg-[#5865F2] hover:bg-[#4752C4] text-white font-medium rounded-lg transition-colors"
                            >
                                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                                    <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
                                </svg>
                                Link Discord Account
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-xl font-semibold text-foreground">Discord Bot</h2>
                <p className="text-sm text-muted mt-1">Enable Discord bot features for event reminders, notifications, and PUG invites.</p>
            </div>
            <IntegrationCard
                title="Discord Bot"
                description="Enable bot features for notifications and event management"
                icon={DiscordBotIcon}
                isConfigured={discordBotStatus.data?.configured ?? false}
                isLoading={discordBotStatus.isLoading}
            >
                <DiscordBotForm />
            </IntegrationCard>

            {/* ROK-293: Ad-Hoc Events Toggle */}
            {discordBotStatus.data?.connected && (
                <div className="bg-surface rounded-xl border border-edge p-6">
                    <div className="flex items-center justify-between">
                        <div>
                            <h3 className="text-base font-semibold text-foreground">
                                Ad-Hoc Voice Events
                            </h3>
                            <p className="text-sm text-muted mt-1">
                                Automatically create events when members join bound voice channels.
                                Disabled by default.
                            </p>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer">
                            <input
                                type="checkbox"
                                checked={adHocEventsStatus.data?.enabled ?? false}
                                onChange={(e) => {
                                    updateAdHocEvents.mutate(
                                        { enabled: e.target.checked },
                                        {
                                            onSuccess: () => {
                                                toast.success(
                                                    e.target.checked
                                                        ? 'Ad-hoc events enabled'
                                                        : 'Ad-hoc events disabled',
                                                );
                                            },
                                            onError: () => {
                                                toast.error('Failed to update ad-hoc events setting');
                                            },
                                        },
                                    );
                                }}
                                disabled={updateAdHocEvents.isPending}
                                className="sr-only peer"
                            />
                            <div className="w-11 h-6 bg-dim rounded-full peer peer-checked:bg-emerald-500 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-emerald-500/50 after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-full" />
                        </label>
                    </div>
                </div>
            )}
        </div>
    );
}
