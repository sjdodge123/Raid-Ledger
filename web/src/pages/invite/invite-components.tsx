import type { JSX } from 'react';
import type { CharacterDto } from '@raid-ledger/contract';
import { formatRole } from '../../lib/role-colors';

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
