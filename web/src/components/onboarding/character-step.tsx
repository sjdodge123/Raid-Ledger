import { useState } from 'react';
import { useGamesDiscover } from '../../hooks/use-games-discover';
import { InlineCharacterForm } from '../characters/inline-character-form';
import type { CharacterDto } from '@raid-ledger/contract';

/** IGDB genre ID 36 = MMORPG */
const MMO_GENRE_ID = 36;

interface CharacterStepProps {
    onNext: () => void;
    onBack: () => void;
    onSkip: () => void;
}

/**
 * Step 3: Create a Character (ROK-219).
 * Only shown when user selected MMO games in Step 2.
 * Reuses InlineCharacterForm component.
 */
export function CharacterStep({ onNext, onBack, onSkip }: CharacterStepProps) {
    const { data: discoverData } = useGamesDiscover();
    const [createdCharacter, setCreatedCharacter] = useState<CharacterDto | null>(null);
    const [selectedGameId, setSelectedGameId] = useState<string>('');

    // Get MMO games from discover data
    const mmoGames =
        discoverData?.rows
            ?.flatMap((row) => row.games)
            .filter((g) => g.genres.includes(MMO_GENRE_ID))
            .filter((g, i, arr) => arr.findIndex((x) => x.id === g.id) === i) ?? [];

    const handleCharacterCreated = (character: CharacterDto) => {
        setCreatedCharacter(character);
    };

    return (
        <div className="space-y-5">
            <div className="text-center">
                <h2 className="text-2xl font-bold text-foreground">Create a Character</h2>
                <p className="text-muted mt-2">
                    Add your main character for one of your MMO games.
                    You can add more later from your profile.
                </p>
            </div>

            {createdCharacter ? (
                <div className="max-w-md mx-auto">
                    <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-4 text-center">
                        <svg
                            className="w-8 h-8 mx-auto mb-2 text-emerald-400"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                        >
                            <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M5 13l4 4L19 7"
                            />
                        </svg>
                        <p className="text-foreground font-medium">
                            {createdCharacter.name} created!
                        </p>
                        <p className="text-sm text-muted mt-1">
                            {createdCharacter.class && `${createdCharacter.class} `}
                            {createdCharacter.role && `(${createdCharacter.role})`}
                        </p>
                    </div>
                </div>
            ) : (
                <div className="max-w-md mx-auto space-y-4">
                    {/* Game selector */}
                    <div>
                        <label
                            htmlFor="game-select"
                            className="block text-sm font-medium text-foreground mb-1"
                        >
                            Game
                        </label>
                        <select
                            id="game-select"
                            value={selectedGameId}
                            onChange={(e) => setSelectedGameId(e.target.value)}
                            className="w-full px-3 py-2.5 bg-panel border border-edge rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm"
                        >
                            <option value="">Select a game...</option>
                            {mmoGames.map((game) => (
                                <option key={game.id} value={String(game.id)}>
                                    {game.name}
                                </option>
                            ))}
                        </select>
                    </div>

                    {/* Character form */}
                    {selectedGameId && (
                        <InlineCharacterForm
                            gameId={selectedGameId}
                            hasRoles
                            gameSlug={
                                mmoGames.find((g) => String(g.id) === selectedGameId)
                                    ?.slug
                            }
                            onCharacterCreated={handleCharacterCreated}
                        />
                    )}
                </div>
            )}

            {/* Navigation */}
            <div className="flex gap-3 justify-center max-w-sm mx-auto">
                <button
                    type="button"
                    onClick={onBack}
                    className="flex-1 px-4 py-2.5 bg-panel hover:bg-overlay text-muted rounded-lg transition-colors text-sm"
                >
                    Back
                </button>
                <button
                    type="button"
                    onClick={onSkip}
                    className="flex-1 px-4 py-2.5 bg-panel hover:bg-overlay text-muted rounded-lg transition-colors text-sm"
                >
                    Skip
                </button>
                <button
                    type="button"
                    onClick={onNext}
                    className="flex-1 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-medium rounded-lg transition-colors text-sm"
                >
                    Next
                </button>
            </div>
        </div>
    );
}
