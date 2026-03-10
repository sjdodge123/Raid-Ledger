import { useItadSettings } from '../../hooks/admin/use-itad-settings';
import { IntegrationCard } from '../../components/admin/IntegrationCard';
import { ItadForm } from '../../components/admin/ItadForm';

const ItadIconBadge = (
    <div className="w-10 h-10 rounded-lg bg-[#4a90d9] flex items-center justify-center">
        <span className="text-white font-bold text-xs">ITAD</span>
    </div>
);

/**
 * Integrations > ITAD panel (ROK-772).
 * IsThereAnyDeal integration for game deal tracking.
 */
export function ItadPanel() {
    const { itadStatus } = useItadSettings();

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-xl font-semibold text-foreground">IsThereAnyDeal</h2>
                <p className="text-sm text-muted mt-1">Enable game deal tracking and price comparison via ITAD.</p>
            </div>
            <IntegrationCard
                title="IsThereAnyDeal"
                description="Game deal tracking and price comparison"
                icon={ItadIconBadge}
                isConfigured={itadStatus.data?.configured ?? false}
                isLoading={itadStatus.isLoading}
            >
                <ItadForm />
            </IntegrationCard>
        </div>
    );
}
