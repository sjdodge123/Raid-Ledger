import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useOnboarding } from '../../hooks/use-onboarding';
import { useAdminSettings } from '../../hooks/use-admin-settings';
import { toast } from '../../lib/toast';
import {
    TIMEZONE_OPTIONS,
    TIMEZONE_GROUPS,
} from '../../constants/timezones';
import { getTimezoneAbbr } from '../../lib/timezone-utils';

/**
 * General > Site Settings panel.
 * ROK-281: Extracted as a routed panel for the admin sidebar.
 * ROK-204: Added "Re-run Setup Wizard" button.
 * ROK-431: Added Default Timezone selector.
 */
export function GeneralPanel() {
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const { resetOnboarding } = useOnboarding();
    const { defaultTimezone, updateTimezone } = useAdminSettings();

    // Track whether the user has made a local selection (optimistic update)
    const [localTz, setLocalTz] = useState<string | null>(null);

    const serverTz = defaultTimezone.data?.timezone ?? '';
    const timezone = localTz ?? serverTz;

    const handleRerunWizard = async () => {
        await resetOnboarding.mutateAsync();
        await Promise.all([
            queryClient.invalidateQueries({ queryKey: ['admin', 'onboarding', 'status'] }),
            queryClient.invalidateQueries({ queryKey: ['system', 'status'] }),
        ]);
        navigate('/admin/setup');
    };

    const handleTimezoneChange = (value: string) => {
        setLocalTz(value);
        updateTimezone.mutate(value, {
            onSuccess: () => {
                setLocalTz(null);
                toast.success('Default timezone updated');
            },
            onError: (err) => {
                setLocalTz(null);
                toast.error(err.message);
            },
        });
    };

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-xl font-semibold text-foreground">Site Settings</h2>
                <p className="text-sm text-muted mt-1">Configure your community timezone and general options.</p>
            </div>

            {/* Default Timezone */}
            <div className="bg-panel/50 rounded-xl border border-edge/50 p-6 space-y-4">
                <div>
                    <h3 className="text-sm font-semibold text-foreground uppercase tracking-wider">
                        Default Timezone
                    </h3>
                    <p className="text-xs text-muted mt-1">
                        Used for Discord embeds and community-wide displays.
                        Individual users see times in their own browser timezone by default.
                    </p>
                </div>
                {defaultTimezone.isLoading ? (
                    <div className="h-11 bg-overlay rounded-lg animate-pulse w-full sm:max-w-md" />
                ) : (
                    <select
                        value={timezone}
                        onChange={(e) => handleTimezoneChange(e.target.value)}
                        disabled={updateTimezone.isPending}
                        className="w-full sm:max-w-md px-4 py-3 min-h-[44px] bg-surface/50 border border-edge rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-colors text-sm disabled:opacity-50"
                    >
                        <option value="">Not set (UTC fallback)</option>
                        {TIMEZONE_GROUPS.map((group) => (
                            <optgroup key={group} label={group}>
                                {TIMEZONE_OPTIONS.filter((o) => o.group === group).map((o) => (
                                    <option key={o.id} value={o.id}>
                                        {o.label} ({getTimezoneAbbr(o.id)})
                                    </option>
                                ))}
                            </optgroup>
                        ))}
                    </select>
                )}
                {timezone && (
                    <p className="text-xs text-muted">
                        Current abbreviation: {getTimezoneAbbr(timezone)}
                    </p>
                )}
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
