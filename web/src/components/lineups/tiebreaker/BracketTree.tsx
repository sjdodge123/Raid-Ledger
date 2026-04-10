/**
 * BracketTree — tiebreaker-specific wrapper around TournamentBracket.
 * Maps BracketMatchupDto to the generic BracketMatchup interface.
 */
import type { JSX } from 'react';
import type { BracketMatchupDto } from '@raid-ledger/contract';
import { TournamentBracket, type BracketMatchup } from '../../common/TournamentBracket';

interface Props {
    matchups: BracketMatchupDto[];
    totalRounds: number;
}

function toGenericMatchup(m: BracketMatchupDto): BracketMatchup {
    return {
        id: m.id,
        round: m.round,
        position: m.position,
        entryA: { id: m.gameA.gameId, name: m.gameA.gameName },
        entryB: m.gameB ? { id: m.gameB.gameId, name: m.gameB.gameName } : null,
        winnerId: m.winnerGameId,
        isBye: m.isBye,
        isActive: m.isActive,
    };
}

export function BracketTree({ matchups }: Props): JSX.Element {
    return (
        <TournamentBracket
            matchups={matchups.map(toGenericMatchup)}
            testId="bracket-tree"
        />
    );
}
