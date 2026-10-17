import { DemoDataCard } from '../../components/admin/DemoDataCard';

/**
 * General > Demo Data panel.
 * ROK-281: Wraps existing DemoDataCard in the admin sidebar layout.
 */
export function DemoDataPanel() {
    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-xl font-semibold text-foreground">Demo Data</h2>
                <p className="text-sm text-muted mt-1">Install or clear sample data for testing.</p>
            </div>
            <DemoDataCard />
        </div>
    );
}
