/**
 * Top-level route component for ROK-1193 lineup wireframes.
 * Handles URL-param parsing, DEMO_MODE gating, and dispatches to the right page wireframe.
 * DEV-ONLY.
 */
import type { JSX } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { useSystemStatus } from '../../hooks/use-system-status';
import {
  isPersona, isPhaseState, isPageId,
  type PageId, type Persona, type PhaseState,
} from './types';
import { WireframeShell } from './WireframeShell';
import { WireframesIndexPage } from './WireframesIndexPage';
import { IndexWireframe } from './pages/IndexWireframe';
import { LineupDetailWireframe } from './pages/LineupDetailWireframe';
import { BuildingWireframe } from './pages/BuildingWireframe';
import { VotingWireframe } from './pages/VotingWireframe';
import { DecidedWireframe } from './pages/DecidedWireframe';
import { TiebreakerWireframe } from './pages/TiebreakerWireframe';
import { SchedulingWireframe } from './pages/SchedulingWireframe';
import { StandalonePollWireframe } from './pages/StandalonePollWireframe';

function PageBody({ pageId, persona, phaseState }: {
  pageId: PageId; persona: Persona; phaseState: PhaseState;
}): JSX.Element {
  switch (pageId) {
    case 'index':
      return <IndexWireframe persona={persona} phaseState={phaseState} />;
    case 'lineup-detail':
      return <LineupDetailWireframe persona={persona} phaseState={phaseState} />;
    case 'building':
      return <BuildingWireframe persona={persona} phaseState={phaseState} />;
    case 'voting':
      return <VotingWireframe persona={persona} phaseState={phaseState} />;
    case 'decided':
      return <DecidedWireframe persona={persona} phaseState={phaseState} />;
    case 'tiebreaker':
      return <TiebreakerWireframe persona={persona} phaseState={phaseState} />;
    case 'scheduling':
      return <SchedulingWireframe persona={persona} phaseState={phaseState} />;
    case 'standalone-poll':
      return <StandalonePollWireframe persona={persona} phaseState={phaseState} />;
  }
}

function useDemoMode(): { ready: boolean; allowed: boolean } {
  const { data, isLoading } = useSystemStatus();
  if (isLoading) return { ready: false, allowed: false };
  return { ready: true, allowed: data?.demoMode === true };
}

function ParsedRoute(): JSX.Element {
  const params = useParams<{ page?: string; persona?: string; state?: string }>();
  const pageId = params.page;
  const persona = params.persona;
  const phaseState = params.state;

  if (!isPageId(pageId)) return <Navigate to="/dev/wireframes/lineup" replace />;
  if (!isPersona(persona)) return <Navigate to={`/dev/wireframes/lineup/${pageId}/invitee-not-acted/plenty-of-time`} replace />;
  if (!isPhaseState(phaseState)) return <Navigate to={`/dev/wireframes/lineup/${pageId}/${persona}/plenty-of-time`} replace />;

  return (
    <WireframeShell pageId={pageId} persona={persona} phaseState={phaseState}>
      <PageBody pageId={pageId} persona={persona} phaseState={phaseState} />
    </WireframeShell>
  );
}

/** Renders the wireframe variant matching :page/:persona/:state, gated by DEMO_MODE. */
export function LineupWireframesRoute(): JSX.Element | null {
  const { ready, allowed } = useDemoMode();
  if (!ready) return null;
  if (!allowed) return <Navigate to="/" replace />;
  return <ParsedRoute />;
}

/** Renders the wireframes index landing page, gated by DEMO_MODE. */
export function LineupWireframesIndexRoute(): JSX.Element | null {
  const { ready, allowed } = useDemoMode();
  if (!ready) return null;
  if (!allowed) return <Navigate to="/" replace />;
  return <WireframesIndexPage />;
}
