/**
 * Wireframe: proposed /lineups index page.
 * Demonstrates F (Page 1 row) — central list view of active + past lineups.
 * DEV-ONLY.
 */
import type { JSX } from 'react';
import { LINEUP, PAST_LINEUPS } from '../fixtures';
import { CoverThumbnail, PrimaryCta, SecondaryCta } from '../ui-bits';
import type { Persona } from '../types';

interface Props { persona: Persona }

function ActiveLineupCard({ persona }: Props): JSX.Element {
  const cta = persona === 'organizer' || persona === 'admin' ? 'Manage' : 'View & vote';
  return (
    <article className="bg-panel/50 border border-edge rounded-lg p-4 flex items-start gap-3">
      <CoverThumbnail name={LINEUP.title} color="#10b981" size="md" />
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2 mb-1">
          <h3 className="text-base font-semibold text-foreground">{LINEUP.title}</h3>
          <span className="px-1.5 py-0.5 text-[10px] uppercase tracking-wider rounded bg-emerald-600/20 text-emerald-300 border border-emerald-500/30">
            Voting
          </span>
        </div>
        <p className="text-xs text-muted">
          {LINEUP.totalVoters}/{LINEUP.totalMembers} participated · {LINEUP.nominatedCount} games · 7h left
        </p>
        <div className="mt-3 flex gap-2">
          <PrimaryCta>{cta}</PrimaryCta>
          <SecondaryCta>Skip</SecondaryCta>
        </div>
      </div>
    </article>
  );
}

function StartLineupCard(): JSX.Element {
  return (
    <article className="bg-panel/30 border border-edge border-dashed rounded-lg p-4">
      <h3 className="text-base font-semibold text-foreground mb-1">Start a new lineup</h3>
      <p className="text-xs text-muted mb-3">Let your community nominate and vote on the next game to play together.</p>
      <PrimaryCta>Start Lineup</PrimaryCta>
    </article>
  );
}

function PastLineupRow({ p }: { p: typeof PAST_LINEUPS[number] }): JSX.Element {
  return (
    <li className="flex items-center justify-between py-2 px-3 bg-overlay/20 rounded">
      <div className="min-w-0">
        <p className="text-sm text-foreground truncate">{p.title}</p>
        <p className="text-xs text-muted">Decided {p.decidedAt} · {p.participants} participants · won by {p.winner}</p>
      </div>
      <button type="button" className="text-xs text-emerald-400 hover:text-emerald-300 flex-shrink-0">View →</button>
    </li>
  );
}

function YourActivityNote({ persona }: { persona: Persona }): JSX.Element | null {
  if (persona !== 'invitee-acted') return null;
  return (
    <p className="text-xs text-emerald-300 mb-3" data-testid="your-activity-note">
      ✓ You've voted on 2 games in {LINEUP.title}. Top candidates close in 7h.
    </p>
  );
}

export function IndexWireframe({ persona }: Props): JSX.Element {
  return (
    <div className="space-y-6">
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-secondary">Active</h2>
          {(persona === 'organizer' || persona === 'admin') && (
            <button type="button" className="text-xs text-amber-400 hover:text-amber-300">+ Start another</button>
          )}
        </div>
        <YourActivityNote persona={persona} />
        <div className="space-y-3">
          <ActiveLineupCard persona={persona} />
          {(persona === 'organizer' || persona === 'admin') && <StartLineupCard />}
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wider text-secondary mb-3">Past</h2>
        <ul className="space-y-2">
          {PAST_LINEUPS.map((p) => (
            <PastLineupRow key={p.id} p={p} />
          ))}
        </ul>
      </section>

      <p className="text-xs text-dim border-t border-edge pt-3">
        <strong>Wireframe note:</strong> this page does not exist today (ROK-1193 audit Page 1). Discovery currently happens via the LineupBanner on /games.
      </p>
    </div>
  );
}
