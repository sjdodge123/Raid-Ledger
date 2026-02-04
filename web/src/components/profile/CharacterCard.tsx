import type { CharacterDto } from '@raid-ledger/contract';
import { useSetMainCharacter, useDeleteCharacter } from '../../hooks/use-character-mutations';

interface CharacterCardProps {
    character: CharacterDto;
    onEdit: (character: CharacterDto) => void;
}

/**
 * Card displaying a single character with actions.
 */
export function CharacterCard({ character, onEdit }: CharacterCardProps) {
    const setMainMutation = useSetMainCharacter();
    const deleteMutation = useDeleteCharacter();

    function handleSetMain() {
        setMainMutation.mutate(character.id);
    }

    function handleDelete() {
        // Using confirm for simplicity - TODO: replace with custom modal in future
        const shouldDelete = window.confirm(`Are you sure you want to delete ${character.name}?`);
        if (shouldDelete) {
            deleteMutation.mutate(character.id);
        }
    }

    const roleColors: Record<string, string> = {
        tank: 'bg-blue-600',
        healer: 'bg-emerald-600',
        dps: 'bg-red-600',
    };

    return (
        <div className="bg-slate-800 border border-slate-700 rounded-lg p-4 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
                {/* Avatar or placeholder */}
                {character.avatarUrl ? (
                    <img
                        src={character.avatarUrl}
                        alt={character.name}
                        className="w-10 h-10 rounded-full bg-slate-700"
                        onError={(e) => {
                            e.currentTarget.style.display = 'none';
                        }}
                    />
                ) : (
                    <div className="w-10 h-10 rounded-full bg-slate-700 flex items-center justify-center text-slate-400">
                        👤
                    </div>
                )}

                <div className="min-w-0">
                    <div className="flex items-center gap-2">
                        <span className="font-medium text-white truncate">
                            {character.name}
                        </span>
                        {character.isMain && (
                            <span className="text-yellow-400" title="Main character">
                                ⭐
                            </span>
                        )}
                    </div>
                    <div className="flex items-center gap-2 text-sm text-slate-400">
                        {character.class && <span>{character.class}</span>}
                        {character.spec && <span>• {character.spec}</span>}
                        {character.role && (
                            <span
                                className={`px-1.5 py-0.5 rounded text-xs text-white ${roleColors[character.role] || 'bg-slate-600'}`}
                            >
                                {character.role.toUpperCase()}
                            </span>
                        )}
                    </div>
                </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2 flex-shrink-0">
                {!character.isMain && (
                    <button
                        onClick={handleSetMain}
                        disabled={setMainMutation.isPending}
                        className="px-3 py-1.5 text-sm text-slate-300 hover:text-white hover:bg-slate-700 rounded transition-colors"
                        title="Set as main"
                    >
                        ⭐ Main
                    </button>
                )}
                <button
                    onClick={() => onEdit(character)}
                    className="px-3 py-1.5 text-sm text-slate-300 hover:text-white hover:bg-slate-700 rounded transition-colors"
                >
                    Edit
                </button>
                <button
                    onClick={handleDelete}
                    disabled={deleteMutation.isPending}
                    className="px-3 py-1.5 text-sm text-red-400 hover:text-red-300 hover:bg-red-950/50 rounded transition-colors"
                >
                    Delete
                </button>
            </div>
        </div>
    );
}
