/**
 * BracketTree SVG (ROK-938).
 * Renders connecting lines between bracket rounds.
 */
import type { JSX } from 'react';
import type { BracketMatchupDto } from '@raid-ledger/contract';

interface Props {
    matchups: BracketMatchupDto[];
    totalRounds: number;
}

/** Compute Y position for a matchup card. */
function matchupY(round: number, position: number): number {
    const spacing = Math.pow(2, round) * 60;
    const offset = spacing / 2;
    return offset + position * spacing;
}

/** Compute X position for a round column. */
function roundX(round: number): number {
    return (round - 1) * 200 + 100;
}

/** Draw connecting lines between parent and child matchups. */
function ConnectingLines({ matchups }: Props): JSX.Element {
    const lines: JSX.Element[] = [];
    const maxRound = Math.max(...matchups.map((m) => m.round), 1);

    for (let round = 2; round <= maxRound; round++) {
        const roundMatchups = matchups
            .filter((m) => m.round === round)
            .sort((a, b) => a.position - b.position);

        for (const m of roundMatchups) {
            const parentX = roundX(round);
            const parentY = matchupY(round, m.position);
            const childPositions = [m.position * 2, m.position * 2 + 1];

            for (const cp of childPositions) {
                const childX = roundX(round - 1);
                const childY = matchupY(round - 1, cp);
                lines.push(
                    <line
                        key={`line-${round}-${m.position}-${cp}`}
                        x1={childX + 80}
                        y1={childY}
                        x2={parentX - 10}
                        y2={parentY}
                        stroke="currentColor"
                        strokeWidth={1.5}
                        className="text-edge"
                    />,
                );
            }
        }
    }

    return <>{lines}</>;
}

export function BracketTree({ matchups, totalRounds }: Props): JSX.Element {
    const maxRound = Math.max(...matchups.map((m) => m.round), 1);
    const width = maxRound * 200 + 50;
    const r1Count = matchups.filter((m) => m.round === 1).length;
    const height = Math.max(r1Count * 120, 240);

    return (
        <div data-testid="bracket-tree" className="overflow-x-auto">
            <svg width={width} height={height} className="text-foreground">
                <ConnectingLines matchups={matchups} totalRounds={totalRounds} />
                {matchups.map((m) => {
                    const x = roundX(m.round) - 70;
                    const y = matchupY(m.round, m.position) - 15;
                    return (
                        <foreignObject key={m.id} x={x} y={y} width={160} height={30}>
                            <div className="text-xs text-center truncate text-muted">
                                {m.gameA.gameName} {m.gameB ? `vs ${m.gameB.gameName}` : '(bye)'}
                            </div>
                        </foreignObject>
                    );
                })}
            </svg>
        </div>
    );
}
