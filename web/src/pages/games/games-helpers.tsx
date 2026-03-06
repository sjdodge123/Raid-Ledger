import { useAdminSettings } from '../../hooks/use-admin-settings';
import { toast } from '../../lib/toast';

/** Toggle switch for the adult content filter */
export function AdultContentFilterToggle(): JSX.Element {
    const { igdbAdultFilter, updateAdultFilter } = useAdminSettings();

    return (
        <div className="flex items-center justify-between bg-panel/50 border border-edge rounded-lg p-4 mb-4">
            <div>
                <span className="text-sm font-medium text-foreground">Filter adult content</span>
                <p className="text-dim text-xs mt-0.5">
                    Hide games with erotic/sexual themes from search and discovery
                </p>
            </div>
            <button
                type="button"
                onClick={() => {
                    const newValue = !igdbAdultFilter.data?.enabled;
                    updateAdultFilter.mutateAsync(newValue).then((result) => {
                        if (result.success) {
                            toast.success(result.message);
                        } else {
                            toast.error(result.message);
                        }
                    }).catch(() => toast.error('Failed to update filter'));
                }}
                disabled={updateAdultFilter.isPending}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 focus:ring-offset-panel ${
                    igdbAdultFilter.data?.enabled ? 'bg-purple-600' : 'bg-overlay'
                } ${updateAdultFilter.isPending ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                role="switch"
                aria-checked={igdbAdultFilter.data?.enabled ?? false}
                aria-label="Filter adult content"
            >
                <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                        igdbAdultFilter.data?.enabled ? 'translate-x-6' : 'translate-x-1'
                    }`}
                />
            </button>
        </div>
    );
}

/** Toggle switch for showing hidden/banned games */
export function ShowHiddenGamesToggle({
    showHidden,
    onToggle,
}: {
    showHidden: 'only' | undefined;
    onToggle: () => void;
}): JSX.Element {
    return (
        <div className="flex items-center justify-between bg-panel/50 border border-edge rounded-lg p-4 mb-6">
            <div>
                <span className="text-sm font-medium text-foreground">Show hidden/banned games</span>
                <p className="text-dim text-xs mt-0.5">
                    View banned and hidden games to restore or unban them
                </p>
            </div>
            <button
                type="button"
                role="switch"
                aria-checked={showHidden === 'only'}
                aria-label="Show hidden games"
                onClick={onToggle}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 focus:ring-offset-panel cursor-pointer ${
                    showHidden === 'only' ? 'bg-purple-600' : 'bg-overlay'
                }`}
            >
                <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                        showHidden === 'only' ? 'translate-x-6' : 'translate-x-1'
                    }`}
                />
            </button>
        </div>
    );
}
