/**
 * Wireframe: proposed /lineups index page.
 * Hero leads; the page focuses on the single active lineup card.
 * Past lineups are collapsed to a compact tail.
 * DEV-ONLY.
 */
import type { JSX } from 'react';
import { LINEUP, PAST_LINEUPS } from '../fixtures';
import { CoverThumbnail } from '../ui-bits';
import { HeroNextStep } from '../HeroNextStep';
import { getHeroCopy } from '../hero-copy';
import type { Persona, PhaseState } from '../types';

interface Props { persona: Persona; phaseState: PhaseState }

function ActiveLineupCard(): JSX.Element {
  return (
    <article className="bg-panel/50 border border-edge rounded-lg p-4 flex items-start gap-3" data-testid="index-active-lineup">
      <CoverThumbnail name={LINEUP.title} color="#10b981" size="md" />
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-base font-semibold text-foreground">{LINEUP.title}</h3>
          <span className="px-1.5 py-0.5 text-[10px] uppercase tracking-wider rounded bg-emerald-600/20 text-emerald-300 border border-emerald-500/30">
            Voting
          </span>
        </div>
        <p className="text-xs text-muted mt-1">
          {LINEUP.totalVoters}/{LINEUP.totalMembers} participated · {LINEUP.nominatedCount} games · 7h left
        </p>
      </div>
    </article>
  );
}

function PastTail(): JSX.Element {
  return (
    <details className="text-sm text-secondary border-t border-edge/40 pt-3">
      <summary className="cursor-pointer text-xs uppercase tracking-wider text-muted hover:text-foreground">
        Past lineups · {PAST_LINEUPS.length}
      </summary>
      <ul className="mt-2 space-y-1">
        {PAST_LINEUPS.map((p) => (
          <li key={p.id} className="text-xs text-muted">
            <span className="text-secondary">{p.title}</span> — won by {p.winner}, {p.participants} participants, {p.decidedAt}
          </li>
        ))}
      </ul>
    </details>
  );
}

function AbortedSnapshot(): JSX.Element {
  return (
    <p className="text-sm text-secondary">
      All active lineups are cancelled. Past lineups are still available below.
    </p>
  );
}

export function IndexWireframe({ persona, phaseState }: Props): JSX.Element {
  const hero = getHeroCopy('index', persona, phaseState);
  return (
    <>
      <HeroNextStep {...hero} />
      <div className="space-y-5">
        {phaseState === 'aborted' ? <AbortedSnapshot /> : <ActiveLineupCard />}
        <PastTail />
        <p className="text-[11px] text-dim">
          <strong>Wireframe note:</strong> this page does not exist today (ROK-1193 audit Page 1). Discovery currently happens via the LineupBanner on /games.
        </p>
      </div>
    </>
  );
}
