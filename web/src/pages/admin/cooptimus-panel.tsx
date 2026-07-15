import { useCooptimusSettings } from '../../hooks/admin/use-cooptimus-settings';
import { IntegrationCard } from '../../components/admin/IntegrationCard';
import { CooptimusForm } from '../../components/admin/CooptimusForm';

const CooptimusIconBadge = (
    <div className="w-10 h-10 rounded-lg bg-[#5b9bd5] flex items-center justify-center">
        <span className="text-white font-bold text-xs">CO-OP</span>
    </div>
);

/**
 * Integrations > Co-Optimus panel (ROK-1397).
 * Co-op facts enrichment (online/couch/LAN player counts, campaign co-op)
 * from co-optimus.com — permission-first; activates once their granted
 * user-agent is saved here.
 */
export function CooptimusPanel() {
    const { cooptimusStatus } = useCooptimusSettings();

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-xl font-semibold text-foreground">Co-Optimus</h2>
                <p className="text-sm text-muted mt-1">Editorial co-op data (player counts, couch/LAN, campaign co-op) with attribution.</p>
            </div>
            <IntegrationCard
                title="Co-Optimus"
                description="Co-op feature enrichment for the games library"
                icon={CooptimusIconBadge}
                isConfigured={cooptimusStatus.data?.configured ?? false}
                isLoading={cooptimusStatus.isLoading}
            >
                <CooptimusForm />
            </IntegrationCard>
        </div>
    );
}
