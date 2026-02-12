/**
 * General > Site Settings panel.
 * Placeholder for community name, description, and basic site settings.
 * ROK-281: Extracted as a routed panel for the admin sidebar.
 */
export function GeneralPanel() {
    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-xl font-semibold text-foreground">Site Settings</h2>
                <p className="text-sm text-muted mt-1">Configure your community name and general options.</p>
            </div>
            <div className="bg-panel/50 rounded-xl border border-edge/50 p-6">
                <p className="text-muted text-sm">
                    Site settings configuration will be available in a future update.
                </p>
            </div>
        </div>
    );
}
