/**
 * Generic tournament bracket SVG component.
 * Renders a single-elimination bracket with connecting lines.
 * Shows the full bracket structure including TBD placeholders for future rounds.
 */
import type { JSX } from 'react';

/** A single entry (participant/team/game) in a bracket slot. */
export interface BracketEntry {
    id: number | string;
    name: string;
}

/** A single matchup in the bracket. */
export interface BracketMatchup {
    id: number | string;
    round: number;
    position: number;
    entryA: BracketEntry;
    entryB: BracketEntry | null;
    winnerId?: number | string | null;
    isBye?: boolean;
    /** Currently being voted on. */
    isActive?: boolean;
}

export interface TournamentBracketProps {
    matchups: BracketMatchup[];
    testId?: string;
}

const BOX_W = 220;
const BOX_H = 32;
const GAP = 4;
const MATCHUP_H = BOX_H * 2 + GAP;
const COL_W = BOX_W + 80;
const ARM = 24;

const TBD_ENTRY: BracketEntry = { id: 'tbd', name: 'TBD' };

function centerY(round: number, position: number): number {
    const spacing = Math.pow(2, round) * (MATCHUP_H + 30);
    return spacing / 2 + position * spacing;
}

function colX(round: number): number {
    return (round - 1) * COL_W + 20;
}

/**
 * Build the full bracket structure with TBD placeholders.
 * Calculates expected rounds from round-1 count and fills gaps.
 */
function buildFullBracket(matchups: BracketMatchup[]): BracketMatchup[] {
    const r1 = matchups.filter((m) => m.round === 1);
    if (r1.length === 0) return matchups;
    const totalRounds = Math.ceil(Math.log2(r1.length * 2));
    const byKey = new Map(matchups.map((m) => [`${m.round}-${m.position}`, m]));
    const full: BracketMatchup[] = [...matchups];

    for (let round = 2; round <= totalRounds; round++) {
        const count = Math.pow(2, totalRounds - round);
        for (let pos = 0; pos < count; pos++) {
            const key = `${round}-${pos}`;
            if (!byKey.has(key)) {
                // Find feeder matchups from previous round
                const feederA = byKey.get(`${round - 1}-${pos * 2}`);
                const feederB = byKey.get(`${round - 1}-${pos * 2 + 1}`);
                const entryA = feederA?.winnerId
                    ? (feederA.winnerId === feederA.entryA.id ? feederA.entryA : feederA.entryB ?? TBD_ENTRY)
                    : TBD_ENTRY;
                const entryB = feederB?.winnerId
                    ? (feederB.winnerId === feederB.entryA.id ? feederB.entryA : feederB.entryB ?? TBD_ENTRY)
                    : TBD_ENTRY;
                const placeholder: BracketMatchup = {
                    id: `placeholder-${key}`,
                    round, position: pos,
                    entryA: entryA, entryB: entryB,
                };
                full.push(placeholder);
                byKey.set(key, placeholder);
            }
        }
    }
    return full;
}

/** Bracket connector lines: arms within matchups + inter-round links. */
function Connectors({ matchups }: { matchups: BracketMatchup[] }): JSX.Element {
    const lines: JSX.Element[] = [];
    const maxRound = Math.max(...matchups.map((m) => m.round), 1);

    for (const m of matchups) {
        const x = colX(m.round);
        const cy = centerY(m.round, m.position);
        const topY = cy - MATCHUP_H / 2 + BOX_H / 2;
        const botY = cy + MATCHUP_H / 2 - BOX_H / 2;
        const rx = x + BOX_W;
        const ax = rx + ARM;

        // Arms from each entry to vertical bar
        lines.push(<line key={`ha-${m.id}`} x1={rx} y1={topY} x2={ax} y2={topY}
            stroke="currentColor" strokeWidth={1.5} className="text-edge" />);
        lines.push(<line key={`hb-${m.id}`} x1={rx} y1={botY} x2={ax} y2={botY}
            stroke="currentColor" strokeWidth={1.5} className="text-edge" />);
        // Vertical bar
        lines.push(<line key={`v-${m.id}`} x1={ax} y1={topY} x2={ax} y2={botY}
            stroke="currentColor" strokeWidth={1.5} className="text-edge" />);

        // Inter-round link: from arm midpoint to next round's entry
        const nextX = colX(m.round + 1);
        const nextPos = Math.floor(m.position / 2);
        const nextCy = centerY(m.round + 1, nextPos);
        // Even position feeds top entry, odd feeds bottom
        const targetY = m.position % 2 === 0
            ? nextCy - MATCHUP_H / 2 + BOX_H / 2
            : nextCy + MATCHUP_H / 2 - BOX_H / 2;

        if (m.round < maxRound) {
            // Horizontal from midpoint, then vertical, then horizontal to target
            const midX = ax + (nextX - ax) / 2;
            lines.push(<line key={`ho1-${m.id}`} x1={ax} y1={cy} x2={midX} y2={cy}
                stroke="currentColor" strokeWidth={1.5} className="text-edge" />);
            lines.push(<line key={`hv-${m.id}`} x1={midX} y1={cy} x2={midX} y2={targetY}
                stroke="currentColor" strokeWidth={1.5} className="text-edge" />);
            lines.push(<line key={`ho2-${m.id}`} x1={midX} y1={targetY} x2={nextX} y2={targetY}
                stroke="currentColor" strokeWidth={1.5} className="text-edge" />);
        } else {
            // Final round: horizontal to champion box
            lines.push(<line key={`ho-${m.id}`} x1={ax} y1={cy} x2={nextX} y2={cy}
                stroke="currentColor" strokeWidth={1.5} className="text-edge" />);
        }
    }
    return <>{lines}</>;
}

/** Single entry slot box. */
function EntryBox({ x, y, name, won, bye, pending, active }: {
    x: number; y: number; name: string; won: boolean;
    bye?: boolean; pending?: boolean; active?: boolean;
}): JSX.Element {
    const fill = won ? 'fill-emerald-500/15' : active ? 'fill-cyan-500/10' : 'fill-[var(--color-panel)]';
    const stroke = won ? 'stroke-emerald-500/50' : active ? 'stroke-cyan-500/60' : 'stroke-[var(--color-edge)]';
    const sw = active ? 2 : 1;
    const text = pending ? 'text-muted italic' : bye ? 'text-muted italic'
        : won ? 'text-emerald-400 font-semibold' : 'text-foreground';
    return (
        <g>
            <rect x={x} y={y} width={BOX_W} height={BOX_H} rx={4}
                className={`${fill} ${stroke}`} strokeWidth={sw}
                strokeDasharray={pending ? '4 3' : undefined} />
            <foreignObject x={x + 8} y={y} width={BOX_W - 16} height={BOX_H}>
                <div className={`flex items-center h-full text-xs truncate ${text}`}>
                    {name}
                </div>
            </foreignObject>
        </g>
    );
}

/** Champion box at the end of the bracket. */
function ChampionBox({ x, y, name }: { x: number; y: number; name: string | null }): JSX.Element {
    const has = !!name;
    return (
        <g>
            <rect x={x} y={y - 4} width={BOX_W} height={BOX_H + 8} rx={6}
                className={has ? 'fill-amber-500/15 stroke-amber-500/50' : 'fill-[var(--color-panel)] stroke-[var(--color-edge)]'}
                strokeWidth={has ? 2 : 1} strokeDasharray={has ? undefined : '4 3'} />
            <foreignObject x={x + 8} y={y - 4} width={BOX_W - 16} height={BOX_H + 8}>
                <div className={`flex items-center h-full text-xs truncate ${has ? 'text-amber-400 font-bold' : 'text-muted italic'}`}>
                    {name ? `🏆 ${name}` : 'Champion'}
                </div>
            </foreignObject>
        </g>
    );
}

export function TournamentBracket({ matchups, testId }: TournamentBracketProps): JSX.Element {
    const full = buildFullBracket(matchups);
    const maxRound = Math.max(...full.map((m) => m.round), 1);
    const finalMatchups = full.filter((m) => m.round === maxRound);
    const champX = colX(maxRound) + BOX_W + ARM * 2;
    const width = champX + BOX_W + 20;

    let maxY = 0;
    for (const m of full) {
        const bottom = centerY(m.round, m.position) + MATCHUP_H / 2;
        if (bottom > maxY) maxY = bottom;
    }
    const height = maxY + 20;

    return (
        <div data-testid={testId} className="overflow-x-auto py-4">
            <svg width={width} height={height} className="text-foreground">
                <Connectors matchups={full} />
                {full.map((m) => {
                    const x = colX(m.round);
                    const cy = centerY(m.round, m.position);
                    const topY = cy - MATCHUP_H / 2;
                    const aWon = !!m.winnerId && m.winnerId === m.entryA.id;
                    const bWon = !!m.winnerId && m.winnerId === m.entryB?.id;
                    const aPending = m.entryA.id === 'tbd';
                    const bPending = !m.entryB || m.entryB.id === 'tbd';
                    const active = !!m.isActive;
                    return (
                        <g key={m.id}>
                            <EntryBox x={x} y={topY} name={m.entryA.name}
                                won={aWon} pending={aPending} active={active} />
                            <EntryBox x={x} y={topY + BOX_H + GAP}
                                name={m.entryB?.name ?? 'BYE'} won={bWon}
                                bye={!m.entryB && !bPending} pending={bPending && !!m.entryB}
                                active={active} />
                        </g>
                    );
                })}
                {finalMatchups.map((m) => {
                    const cy = centerY(m.round, m.position);
                    const winnerName = m.winnerId
                        ? (m.winnerId === m.entryA.id ? m.entryA.name : m.entryB?.name ?? null)
                        : null;
                    return (
                        <ChampionBox key={`champ-${m.id}`}
                            x={champX} y={cy - BOX_H / 2} name={winnerName} />
                    );
                })}
            </svg>
        </div>
    );
}
