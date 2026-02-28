import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AppearancePanel } from './appearance-panel';
import { TimezoneSection } from '../../components/profile/TimezoneSection';
import { getMyPreferences, updatePreference } from '../../lib/api-client';
import { useAuth } from '../../hooks/use-auth';

/**
 * ROK-443: Privacy settings section — show_activity toggle.
 */
function PrivacySection() {
    const { isAuthenticated } = useAuth();
    const queryClient = useQueryClient();

    const { data: prefs } = useQuery({
        queryKey: ['user-preferences'],
        queryFn: getMyPreferences,
        enabled: isAuthenticated,
        staleTime: Infinity,
    });

    const mutation = useMutation({
        mutationFn: (value: boolean) => updatePreference('show_activity', value),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['user-preferences'] });
        },
    });

    // Default to true if preference not set
    const showActivity = prefs?.show_activity !== false;

    return (
        <div className="bg-surface border border-edge-subtle rounded-xl p-6">
            <h2 className="text-xl font-semibold text-foreground mb-1">Privacy</h2>
            <p className="text-sm text-muted mb-5">Control what others can see on your profile</p>
            <label className="flex items-center gap-3 cursor-pointer">
                <input
                    type="checkbox"
                    checked={showActivity}
                    onChange={(e) => mutation.mutate(e.target.checked)}
                    disabled={mutation.isPending}
                    className="w-4 h-4 rounded border-edge text-emerald-600 focus:ring-emerald-500"
                />
                <div>
                    <span className="text-sm font-medium text-foreground">
                        Show my game activity publicly
                    </span>
                    <p className="text-xs text-muted">
                        When disabled, your game activity is hidden from your profile and game leaderboards
                    </p>
                </div>
            </label>
        </div>
    );
}

/**
 * Consolidated Preferences panel (ROK-359).
 * Merges Appearance, Timezone, and Privacy settings into a single page.
 */
export function PreferencesPanel() {
    return (
        <div className="space-y-6">
            <AppearancePanel />
            <TimezoneSection />
            <PrivacySection />
        </div>
    );
}
