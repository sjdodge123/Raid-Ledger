import type { CharacterDto } from '@raid-ledger/contract';
import { formatRole } from '../../lib/role-colors';

/** Discord brand SVG icon */
export const DISCORD_ICON = (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
        <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515a.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0a12.64 12.64 0 0 0-.617-1.25a.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057a19.9 19.9 0 0 0 5.993 3.03a.078.078 0 0 0 .084-.028a14.09 14.09 0 0 0 1.226-1.994a.076.076 0 0 0-.041-.106a13.107 13.107 0 0 1-1.872-.892a.077.077 0 0 1-.008-.128a10.2 10.2 0 0 0 .372-.292a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127a12.299 12.299 0 0 1-1.873.892a.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028a19.839 19.839 0 0 0 6.002-3.03a.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03z" />
    </svg>
);

/** Green checkmark icon */
export const CHECK_ICON = (
    <svg className="w-8 h-8 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
    </svg>
);

/** Step labels for the progress indicator */
export const STEP_LABELS = ['Authenticate', 'Character', 'Join', 'Discord'];

/** Step indicator for the invite wizard */
// eslint-disable-next-line max-lines-per-function
export function StepIndicator({ current, total, labels }: { current: number; total: number; labels: string[] }): JSX.Element {
    return (
        <div className="flex items-center justify-center gap-2 mb-6">
            {Array.from({ length: total }, (_, i) => {
                const stepNum = i + 1;
                const isActive = stepNum === current;
                const isCompleted = stepNum < current;
                return (
                    <div key={i} className="flex items-center gap-2">
                        <div className="flex flex-col items-center">
                            <div
                                className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold transition-colors ${
                                    isActive
                                        ? 'bg-emerald-600 text-white'
                                        : isCompleted
                                          ? 'bg-emerald-600/30 text-emerald-400'
                                          : 'bg-panel text-muted border border-edge'
                                }`}
                            >
                                {isCompleted ? (
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                    </svg>
                                ) : (
                                    stepNum
                                )}
                            </div>
                            <span className={`text-[10px] mt-1 ${isActive ? 'text-foreground' : 'text-muted'}`}>
                                {labels[i]}
                            </span>
                        </div>
                        {i < total - 1 && (
                            <div
                                className={`w-8 h-px mb-4 ${
                                    isCompleted ? 'bg-emerald-600/50' : 'bg-edge'
                                }`}
                            />
                        )}
                    </div>
                );
            })}
        </div>
    );
}

/** Character card for selecting an existing character */
export function CharacterCard({
    character,
    isSelected,
    onSelect,
}: {
    character: CharacterDto;
    isSelected: boolean;
    onSelect: () => void;
}): JSX.Element {
    const role = character.effectiveRole ?? character.roleOverride ?? character.role;
    return (
        <button
            type="button"
            onClick={onSelect}
            className={`w-full flex items-center gap-3 p-3 rounded-lg border transition-colors text-left ${
                isSelected
                    ? 'bg-emerald-600/10 border-emerald-500'
                    : 'bg-panel border-edge hover:border-foreground/30'
            }`}
        >
            <CharacterAvatar name={character.name} avatarUrl={character.avatarUrl ?? null} />
            <div className="flex-1 min-w-0">
                <div className="font-medium text-foreground text-sm truncate">
                    {character.name}
                </div>
                <div className="text-xs text-muted truncate">
                    {[character.realm, character.class, character.spec].filter(Boolean).join(' - ')}
                </div>
            </div>
            {role && (
                <span className={`text-xs font-medium px-2 py-0.5 rounded ${
                    isSelected ? 'bg-emerald-600/20 text-emerald-400' : 'bg-surface text-muted'
                }`}>
                    {formatRole(role)}
                </span>
            )}
        </button>
    );
}

/** Avatar for a character card */
function CharacterAvatar({ name, avatarUrl }: { name: string; avatarUrl: string | null }): JSX.Element {
    if (avatarUrl) {
        return (
            <img
                src={avatarUrl}
                alt={name}
                className="w-10 h-10 rounded-full object-cover"
                onError={(e) => {
                    (e.target as HTMLImageElement).style.display = 'none';
                }}
            />
        );
    }
    return (
        <div className="w-10 h-10 rounded-full bg-surface flex items-center justify-center text-muted text-sm font-bold">
            {name.charAt(0).toUpperCase()}
        </div>
    );
}
