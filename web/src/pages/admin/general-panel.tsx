import { useNavigate } from 'react-router-dom';
import { useOnboarding } from '../../hooks/use-onboarding';

/**
 * General > Site Settings panel.
 * ROK-281: Extracted as a routed panel for the admin sidebar.
 * ROK-204: Added "Re-run Setup Wizard" button.
 */
export function GeneralPanel() {
    const navigate = useNavigate();
    const { resetOnboarding } = useOnboarding();

    const handleRerunWizard = () => {
        resetOnboarding.mutate(undefined, {
            onSuccess: () => {
                navigate('/admin/setup');
            },
        });
    };

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

            {/* Setup Wizard */}
            <div className="bg-panel/50 rounded-xl border border-edge/50 p-6 space-y-3">
                <h3 className="text-sm font-semibold text-foreground uppercase tracking-wider">
                    Setup Wizard
                </h3>
                <p className="text-sm text-muted">
                    Re-run the initial setup wizard to reconfigure your community name,
                    branding, plugins, and integrations.
                </p>
                <button
                    onClick={handleRerunWizard}
                    disabled={resetOnboarding.isPending}
                    className="px-4 py-2 text-sm font-medium bg-surface/50 hover:bg-surface border border-edge rounded-lg text-foreground transition-colors disabled:opacity-50"
                >
                    {resetOnboarding.isPending ? 'Resetting...' : 'Re-run Setup Wizard'}
                </button>
            </div>
        </div>
    );
}
