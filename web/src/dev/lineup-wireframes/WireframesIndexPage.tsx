/**
 * Landing page at /dev/wireframes/lineup — lists every wireframe variant.
 * DEV-ONLY (DEMO_MODE-gated).
 */
import type { JSX } from 'react';
import { Link } from 'react-router-dom';
import {
  PAGE_IDS, PAGE_LABELS, PERSONAS, PHASE_STATES,
  PERSONA_LABELS, PHASE_STATE_LABELS,
} from './types';

const DEFAULT_PERSONA = PERSONAS[0];
const DEFAULT_STATE = PHASE_STATES[0];

function PageQuickLink({ pageId }: { pageId: typeof PAGE_IDS[number] }): JSX.Element {
  return (
    <li>
      <Link
        to={`/dev/wireframes/lineup/${pageId}/${DEFAULT_PERSONA}/${DEFAULT_STATE}`}
        className="block px-3 py-2 bg-panel/40 border border-edge rounded hover:border-emerald-500/50 transition-colors"
        data-testid={`wireframe-quicklink-${pageId}`}
      >
        <span className="text-sm font-medium text-foreground">{PAGE_LABELS[pageId]}</span>
        <span className="block text-xs text-muted">/dev/wireframes/lineup/{pageId}/...</span>
      </Link>
    </li>
  );
}

function PersonaList(): JSX.Element {
  return (
    <ul className="text-sm text-secondary space-y-1">
      {PERSONAS.map((p) => (
        <li key={p}><code className="text-xs text-emerald-300">{p}</code> — {PERSONA_LABELS[p]}</li>
      ))}
    </ul>
  );
}

function PhaseStateList(): JSX.Element {
  return (
    <ul className="text-sm text-secondary space-y-1">
      {PHASE_STATES.map((s) => (
        <li key={s}><code className="text-xs text-emerald-300">{s}</code> — {PHASE_STATE_LABELS[s]}</li>
      ))}
    </ul>
  );
}

function Intro(): JSX.Element {
  return (
    <header className="mb-6 border-b border-edge pb-4">
      <p className="text-xs uppercase tracking-wider text-amber-400 mb-1">DEMO_MODE wireframe — ROK-1193</p>
      <h1 className="text-xl font-bold text-foreground">Lineup UX wireframes</h1>
      <p className="text-sm text-muted mt-1">
        Static, click-through previews of proposed lineup-page redesigns. URL pattern:{' '}
        <code className="text-xs text-emerald-300">/dev/wireframes/lineup/:page/:persona/:state</code>.
        Use the persona + phase-state switchers inside each page to navigate the matrix.
      </p>
    </header>
  );
}

export function WireframesIndexPage(): JSX.Element {
  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      <Intro />

      <section className="mb-6">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-secondary mb-3">Pages</h2>
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {PAGE_IDS.map((id) => <PageQuickLink key={id} pageId={id} />)}
        </ul>
      </section>

      <section className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-6">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-secondary mb-2">Personas</h2>
          <PersonaList />
        </div>
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-secondary mb-2">Phase states</h2>
          <PhaseStateList />
        </div>
      </section>

      <section className="text-xs text-dim border-t border-edge pt-4">
        <p>Audit doc: <code>planning-artifacts/lineup-ux-audit.md</code></p>
        <p>This route is gated behind DEMO_MODE — it 404s when demo mode is off.</p>
      </section>
    </div>
  );
}
