import type { CharacterDto } from '@raid-ledger/contract';
import { useGameRegistry } from '../../hooks/use-game-registry';
import { CharacterCard } from './CharacterCard';

interface CharacterListProps {
    characters: CharacterDto[];
    onEdit: (character: CharacterDto) => void;
}

/**
 * Displays a list of characters grouped by game.
 * Each group shows the game name as a heading so it is clear
 * which games the characters belong to.
 */
export function CharacterList({ characters, onEdit }: CharacterListProps) {
    const { games } = useGameRegistry();

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

    // Build a map of gameId -> game name for headings
    const gameNameMap = new Map(games.map((g) => [g.id, g.name]));

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
            {Object.entries(grouped).map(([gameId, chars]) => {
                const gameName = gameNameMap.get(Number(gameId)) ?? 'Unknown Game';
                return (
                    <div key={gameId}>
                        <div className="flex items-center gap-3 mb-3">
                            <h3 className="text-sm font-semibold text-foreground">
                                {gameName}
                            </h3>
                            <span className="text-xs text-muted">
                                {chars.length} character{chars.length !== 1 ? 's' : ''}
                            </span>
                            <div className="flex-1 border-t border-edge-subtle" />
                        </div>
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
                );
            })}
        </div>
    );
}
