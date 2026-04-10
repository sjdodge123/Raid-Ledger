/**
 * BracketMatchupCard (ROK-938).
 * Displays a single bracket matchup: Game A vs Game B with vote buttons.
 */
import type { JSX } from 'react';
import type { BracketMatchupDto } from '@raid-ledger/contract';
import { useCastBracketVote } from '../../../hooks/use-tiebreaker';

interface Props {
    matchup: BracketMatchupDto;
    lineupId: number;
}

/** Single game slot within a matchup. */
function GameSlot({ name, isWinner }: { name: string; isWinner: boolean }): JSX.Element {
    return (
        <span
            data-testid="matchup-game-name"
            className={`text-sm font-medium ${isWinner ? 'text-emerald-400' : 'text-foreground'}`}
        >
            {name}
        </span>
    );
}

export function BracketMatchupCard({ matchup, lineupId }: Props): JSX.Element {
    const voteMutation = useCastBracketVote();
    const hasVoted = matchup.myVote !== null;

    function handleVote(gameId: number) {
        voteMutation.mutate({ lineupId, matchupId: matchup.id, gameId });
    }

    return (
        <div
            data-testid="bracket-matchup-card"
            data-active={matchup.isActive ? 'true' : undefined}
            data-completed={matchup.isCompleted ? 'true' : undefined}
            data-voted={hasVoted ? 'true' : undefined}
            className="bg-panel border border-edge rounded-lg p-3 mb-2"
        >
            <div className="flex items-center justify-between gap-2">
                <div className="flex-1">
                    <GameSlot
                        name={matchup.gameA.gameName}
                        isWinner={matchup.winnerGameId === matchup.gameA.gameId}
                    />
                    {matchup.isActive && (
                        <button
                            data-testid="bracket-vote-button"
                            type="button"
                            onClick={() => handleVote(matchup.gameA.gameId)}
                            disabled={hasVoted || voteMutation.isPending}
                            className="ml-2 px-2 py-0.5 text-xs bg-emerald-600 text-white rounded disabled:opacity-50"
                        >
                            Vote ({matchup.voteCountA})
                        </button>
                    )}
                    {matchup.isCompleted && matchup.winnerGameId === matchup.gameA.gameId && (
                        <span data-testid="matchup-winner" className="ml-2 text-xs text-emerald-400">Winner</span>
                    )}
                </div>
                <span className="text-xs text-dim">vs</span>
                <div className="flex-1 text-right">
                    <GameSlot
                        name={matchup.gameB?.gameName ?? 'BYE'}
                        isWinner={matchup.winnerGameId === matchup.gameB?.gameId}
                    />
                    {matchup.isActive && matchup.gameB && (
                        <button
                            data-testid="bracket-vote-button"
                            type="button"
                            onClick={() => handleVote(matchup.gameB!.gameId)}
                            disabled={hasVoted || voteMutation.isPending}
                            className="ml-2 px-2 py-0.5 text-xs bg-emerald-600 text-white rounded disabled:opacity-50"
                        >
                            Vote ({matchup.voteCountB})
                        </button>
                    )}
                    {matchup.isCompleted && matchup.winnerGameId === matchup.gameB?.gameId && (
                        <span data-testid="matchup-winner" className="ml-2 text-xs text-emerald-400">Winner</span>
                    )}
                </div>
            </div>
        </div>
    );
}
