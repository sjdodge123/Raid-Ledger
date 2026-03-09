import { useAdminSettings } from '../../hooks/use-admin-settings';
import { IntegrationCard } from '../../components/admin/IntegrationCard';
import { SteamForm } from '../../components/admin/SteamForm';
import { SteamIcon } from '../../components/icons/SteamIcon';

const SteamIconBadge = (
    <div className="w-10 h-10 rounded-lg bg-[#1B2838] flex items-center justify-center">
        <SteamIcon className="w-6 h-6 text-foreground" />
    </div>
);

/**
 * Integrations > Steam panel.
 * ROK-745: Wraps existing IntegrationCard + SteamForm.
 */
export function SteamPanel() {
    const { steamStatus } = useAdminSettings();

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-xl font-semibold text-foreground">Steam</h2>
                <p className="text-sm text-muted mt-1">Enable Steam account linking and game library sync.</p>
            </div>
            <IntegrationCard
                title="Steam"
                description="Enable Steam account linking and game library sync"
                icon={SteamIconBadge}
                isConfigured={steamStatus.data?.configured ?? false}
                isLoading={steamStatus.isLoading}
            >
                <SteamForm />
            </IntegrationCard>
        </div>
    );
}
