import { useAdminSettings } from '../../hooks/use-admin-settings';
import { toast } from '../../lib/toast';

/** Compound genre filter -- supports multi-genre matching (e.g. MMORPG = RPG + Online) */
export interface GenreFilterDef {
    key: string;
    label: string;
    match: (genres: number[]) => boolean;
}

/** Genre filter definitions for IGDB genre IDs */
export const GENRE_FILTERS: GenreFilterDef[] = [
    { key: 'rpg', label: 'RPG', match: (g) => g.includes(12) },
    { key: 'shooter', label: 'Shooter', match: (g) => g.includes(5) },
    { key: 'adventure', label: 'Adventure', match: (g) => g.includes(31) },
    { key: 'strategy', label: 'Strategy', match: (g) => g.includes(15) },
    { key: 'simulator', label: 'Simulator', match: (g) => g.includes(13) },
    { key: 'sport', label: 'Sport', match: (g) => g.includes(14) },
    { key: 'racing', label: 'Racing', match: (g) => g.includes(10) },
    { key: 'fighting', label: 'Fighting', match: (g) => g.includes(4) },
    { key: 'indie', label: 'Indie', match: (g) => g.includes(32) },
    { key: 'mmorpg', label: 'MMORPG', match: (g) => g.includes(12) && g.includes(36) },
    { key: 'moba', label: 'MOBA', match: (g) => g.includes(36) && !g.includes(12) },
];

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
