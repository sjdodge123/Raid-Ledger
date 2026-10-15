/**
 * Pelican admin panel (ROK-121), rendered in the `admin-settings:plugin-content`
 * slot. Renders nothing for any other plugin/integration, so its config query
 * only runs on its own panel.
 */
import { getPluginBadge } from '../../plugin-registry';
import { IntegrationCard } from '../../../components/admin/IntegrationCard';
import { usePelicanConfig } from '../hooks/use-pelican-config';
import { PelicanConnectionForm } from './pelican-connection-form';
import { PelicanSetupSteps } from './pelican-setup-steps';
import { PelicanServersSection } from './pelican-servers-section';
import { isPelicanConfigured } from './pelican-form.helpers';
import { isPelicanSlot } from './pelican-slot.helpers';

/** Loaded lazily by `PelicanPluginSlot` (the entry-chunk gate registered in the slot). */
export function PelicanPanel() {
    const { data: config, isLoading, isError } = usePelicanConfig();
    return (
        <IntegrationCard title="Pelican" description="Game-server panel connection" icon={null}
            pluginBadge={getPluginBadge('pelican')} isConfigured={config ? isPelicanConfigured(config) : false}
            isLoading={isLoading}>
            <section className="space-y-4" aria-labelledby="pelican-connection-title">
                <h3 id="pelican-connection-title" className="text-lg font-semibold text-foreground border-b border-edge pb-2">Connection</h3>
                {isError && <p role="alert" className="text-sm text-danger">Couldn&apos;t load the Pelican settings.</p>}
                {config && (
                    <>
                        <PelicanSetupSteps />
                        <PelicanConnectionForm config={config} />
                    </>
                )}
            </section>
            {config && isPelicanConfigured(config) && <PelicanServersSection />}
        </IntegrationCard>
    );
}

export function PelicanPluginContent({ pluginSlug, integrationKey }: { pluginSlug?: string; integrationKey?: string }) {
    if (!isPelicanSlot(pluginSlug, integrationKey)) return null;
    return <PelicanPanel />;
}
