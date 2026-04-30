/**
 * Shared shell for ROK-1193 lineup wireframes.
 * Renders sidebar (page links) + persona/phase switchers + content area.
 * DEV-ONLY.
 */
import type { JSX, ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  PERSONAS,
  PHASE_STATES,
  PAGE_IDS,
  PERSONA_LABELS,
  PHASE_STATE_LABELS,
  PAGE_LABELS,
  type Persona,
  type PhaseState,
  type PageId,
} from './types';

interface ShellProps {
  pageId: PageId;
  persona: Persona;
  phaseState: PhaseState;
  children: ReactNode;
}

function buildPath(pageId: PageId, persona: Persona, phaseState: PhaseState): string {
  return `/dev/wireframes/lineup/${pageId}/${persona}/${phaseState}`;
}

function PersonaSwitcher({ pageId, persona, phaseState }: {
  pageId: PageId; persona: Persona; phaseState: PhaseState;
}): JSX.Element {
  const navigate = useNavigate();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs uppercase tracking-wider text-muted">Persona</span>
      <select
        value={persona}
        onChange={(e) => navigate(buildPath(pageId, e.target.value as Persona, phaseState))}
        className="bg-panel border border-edge rounded px-2 py-1 text-sm text-foreground"
        data-testid="wireframe-persona-switcher"
      >
        {PERSONAS.map((p) => (
          <option key={p} value={p}>{PERSONA_LABELS[p]}</option>
        ))}
      </select>
    </div>
  );
}

function PhaseStateSwitcher({ pageId, persona, phaseState }: {
  pageId: PageId; persona: Persona; phaseState: PhaseState;
}): JSX.Element {
  const navigate = useNavigate();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs uppercase tracking-wider text-muted">Phase state</span>
      <select
        value={phaseState}
        onChange={(e) => navigate(buildPath(pageId, persona, e.target.value as PhaseState))}
        className="bg-panel border border-edge rounded px-2 py-1 text-sm text-foreground"
        data-testid="wireframe-phase-switcher"
      >
        {PHASE_STATES.map((s) => (
          <option key={s} value={s}>{PHASE_STATE_LABELS[s]}</option>
        ))}
      </select>
    </div>
  );
}

function SidebarLink({ id, isActive, href }: { id: PageId; isActive: boolean; href: string }): JSX.Element {
  return (
    <li>
      <Link
        to={href}
        className={`block px-2 py-1 text-sm rounded transition-colors ${
          isActive
            ? 'bg-emerald-600/20 text-emerald-300 font-medium'
            : 'text-secondary hover:text-foreground hover:bg-overlay/40'
        }`}
        data-testid={`wireframe-page-link-${id}`}
      >
        {PAGE_LABELS[id]}
      </Link>
    </li>
  );
}

function PageSidebar({ pageId, persona, phaseState }: {
  pageId: PageId; persona: Persona; phaseState: PhaseState;
}): JSX.Element {
  return (
    <nav
      aria-label="Wireframe pages"
      className="md:sticky md:top-4 md:max-h-[calc(100vh-2rem)] md:overflow-y-auto bg-panel/50 border border-edge rounded-lg p-3 mb-4 md:mb-0 flex-shrink-0 md:w-56"
    >
      <p className="text-xs uppercase tracking-wider text-muted mb-2">Pages</p>
      <ul className="space-y-1">
        {PAGE_IDS.map((id) => (
          <SidebarLink key={id} id={id} isActive={id === pageId} href={buildPath(id, persona, phaseState)} />
        ))}
      </ul>
    </nav>
  );
}

function ShellHeader({ pageId, persona, phaseState }: {
  pageId: PageId; persona: Persona; phaseState: PhaseState;
}): JSX.Element {
  return (
    <header className="border-b border-edge pb-3 mb-4">
      <div className="flex flex-wrap items-baseline gap-2 mb-2">
        <Link to="/dev/wireframes/lineup" className="text-xs text-muted hover:text-foreground transition-colors">
          /dev/wireframes
        </Link>
        <span className="text-dim">/</span>
        <h1 className="text-base font-semibold text-foreground">{PAGE_LABELS[pageId]}</h1>
        <span className="text-xs text-amber-400 ml-2">DEMO_MODE wireframe — ROK-1193</span>
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
        <PersonaSwitcher pageId={pageId} persona={persona} phaseState={phaseState} />
        <PhaseStateSwitcher pageId={pageId} persona={persona} phaseState={phaseState} />
      </div>
    </header>
  );
}

export function WireframeShell({ pageId, persona, phaseState, children }: ShellProps): JSX.Element {
  return (
    <div className="max-w-7xl mx-auto px-4 py-4">
      <div className="flex flex-col md:flex-row md:gap-6">
        <PageSidebar pageId={pageId} persona={persona} phaseState={phaseState} />
        <main className="flex-1 min-w-0">
          <ShellHeader pageId={pageId} persona={persona} phaseState={phaseState} />
          {children}
        </main>
      </div>
    </div>
  );
}
