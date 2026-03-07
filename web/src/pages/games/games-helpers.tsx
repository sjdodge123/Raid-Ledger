import type { JSX } from 'react';
import { useAdminSettings } from '../../hooks/use-admin-settings';
import { toast } from '../../lib/toast';

function ToggleSwitch({ enabled, isPending, onToggle, ariaLabel }: {
    enabled: boolean; isPending: boolean; onToggle: () => void; ariaLabel: string;
}) {
    return (
        <button type="button" onClick={onToggle} disabled={isPending} role="switch" aria-checked={enabled} aria-label={ariaLabel}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 focus:ring-offset-panel ${enabled ? 'bg-purple-600' : 'bg-overlay'} ${isPending ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}>
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${enabled ? 'translate-x-6' : 'translate-x-1'}`} />
        </button>
    );
}

function handleAdultFilterToggle(igdbAdultFilter: { data?: { enabled: boolean } }, updateAdultFilter: { mutateAsync: (v: boolean) => Promise<{ success: boolean; message: string }> }) {
    const newValue = !igdbAdultFilter.data?.enabled;
    updateAdultFilter.mutateAsync(newValue).then((result) => {
        if (result.success) toast.success(result.message); else toast.error(result.message);
    }).catch(() => toast.error('Failed to update filter'));
}

/** Toggle switch for the adult content filter */
export function AdultContentFilterToggle(): JSX.Element {
    const { igdbAdultFilter, updateAdultFilter } = useAdminSettings();
    return (
        <div className="flex items-center justify-between bg-panel/50 border border-edge rounded-lg p-4 mb-4">
            <div>
                <span className="text-sm font-medium text-foreground">Filter adult content</span>
                <p className="text-dim text-xs mt-0.5">Hide games with erotic/sexual themes from search and discovery</p>
            </div>
            <ToggleSwitch enabled={igdbAdultFilter.data?.enabled ?? false} isPending={updateAdultFilter.isPending}
                onToggle={() => handleAdultFilterToggle(igdbAdultFilter, updateAdultFilter)} ariaLabel="Filter adult content" />
        </div>
    );
}

/** Toggle switch for showing hidden/banned games */
export function ShowHiddenGamesToggle({ showHidden, onToggle }: { showHidden: 'only' | undefined; onToggle: () => void }): JSX.Element {
    return (
        <div className="flex items-center justify-between bg-panel/50 border border-edge rounded-lg p-4 mb-6">
            <div>
                <span className="text-sm font-medium text-foreground">Show hidden/banned games</span>
                <p className="text-dim text-xs mt-0.5">View banned and hidden games to restore or unban them</p>
            </div>
            <ToggleSwitch enabled={showHidden === 'only'} isPending={false} onToggle={onToggle} ariaLabel="Show hidden games" />
        </div>
    );
}
