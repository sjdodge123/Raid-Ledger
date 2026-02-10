import type { CharacterDto } from '@raid-ledger/contract';
import { CharacterCard } from './CharacterCard';

interface CharacterListProps {
    characters: CharacterDto[];
    onEdit: (character: CharacterDto) => void;
}

/**
 * Displays a list of characters grouped by game.
 */
export function CharacterList({ characters, onEdit }: CharacterListProps) {
    if (characters.length === 0) {
        return (
            <div className="text-center py-12">
                <div className="text-4xl mb-4">🎮</div>
                <p className="text-muted text-lg">No characters yet</p>
                <p className="text-dim text-sm mt-1">
                    Add your first character to get started
                </p>
            </div>
        );
    }

    // Group characters by gameId
    const grouped = characters.reduce((acc, char) => {
        const game = char.gameId;
        if (!acc[game]) {
            acc[game] = [];
        }
        acc[game].push(char);
        return acc;
    }, {} as Record<string, CharacterDto[]>);

    // Sort each group: main first, then by displayOrder
    Object.values(grouped).forEach((chars) => {
        chars.sort((a, b) => {
            if (a.isMain && !b.isMain) return -1;
            if (!a.isMain && b.isMain) return 1;
            return a.displayOrder - b.displayOrder;
        });
    });

    return (
        <div className="space-y-6">
            {Object.entries(grouped).map(([gameId, chars]) => (
                <div key={gameId}>
                    <h3 className="text-sm font-medium text-muted uppercase tracking-wide mb-3">
                        {chars.length} Character{chars.length !== 1 ? 's' : ''}
                    </h3>
                    <div className="space-y-2">
                        {chars.map((character) => (
                            <CharacterCard
                                key={character.id}
                                character={character}
                                onEdit={onEdit}
                            />
                        ))}
                    </div>
                </div>
            ))}
        </div>
    );
}
