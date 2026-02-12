/**
 * Appearance > Theme panel.
 * Placeholder for theme customization (light/dark, colors).
 * ROK-281: Routed panel stub.
 */
export function ThemePanel() {
    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-xl font-semibold text-foreground">Theme</h2>
                <p className="text-sm text-muted mt-1">Configure the visual theme for your community.</p>
            </div>
            <div className="bg-panel/50 rounded-xl border border-edge/50 p-6">
                <p className="text-muted text-sm">
                    Theme customization will be available in a future update.
                </p>
            </div>
        </div>
    );
}
