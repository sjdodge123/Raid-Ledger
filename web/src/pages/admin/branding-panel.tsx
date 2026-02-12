/**
 * Appearance > Branding panel.
 * Placeholder for community branding (logo, name, accent color).
 * ROK-281: Routed panel stub — full implementation in ROK-271.
 */
export function BrandingPanel() {
    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-xl font-semibold text-foreground">Branding</h2>
                <p className="text-sm text-muted mt-1">Customize your community name, logo, and accent color.</p>
            </div>
            <div className="bg-panel/50 rounded-xl border border-edge/50 p-6">
                <p className="text-muted text-sm">
                    Branding settings will be available in a future update.
                </p>
            </div>
        </div>
    );
}
