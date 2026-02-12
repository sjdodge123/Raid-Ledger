import { RelayHubCard } from '../../components/admin/RelayHubCard';

/**
 * Integrations > Relay Hub panel.
 * ROK-281: Wraps existing RelayHubCard.
 */
export function RelayPanel() {
    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-xl font-semibold text-foreground">Relay Hub</h2>
                <p className="text-sm text-muted mt-1">Configure the relay hub for cross-service communication.</p>
            </div>
            <RelayHubCard />
        </div>
    );
}
