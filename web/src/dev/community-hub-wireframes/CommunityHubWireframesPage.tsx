/**
 * ROK-1870 — game community hubs (a third hub kind, `game_community`).
 * DEMO_MODE-gated, dev-only wireframe for the operator to rule on before
 * implementation. Implements the operator rulings of 2026-10-20: members
 * propose a hub from the game page, admins approve in Admin → Hubs, open Join
 * for anyone in the Discord server, several named hubs per game, and a
 * browsable `/hubs` directory. Spec: `planning-artifacts/specs/ROK-1870.md`.
 *
 * All data is mocked (`community-hub-mock.ts`). Gated like
 * `ServerScheduleWireframesPage`: `useSystemStatus().demoMode`, redirect to `/`
 * when false, lazily imported from `lazy-routes.ts`.
 */
import { useState, type JSX } from 'react';
import { Navigate } from 'react-router-dom';
import { useSystemStatus } from '../../hooks/use-system-status';
import { SchemeSwitcher, SideBySideToggle } from '../design-system/scheme-controls';
import { useForcedDarkRoot } from '../design-system/scheme-hooks';
import { DualFamily } from '../design-system/dual-family';
import { Frame } from './wf-bits';
import { GameCardFrames } from './GameCardFrame';
import { AdminQueueFrames } from './AdminQueueFrame';
import { HubPageFrames } from './HubPageFrame';
import { DirectoryFrames } from './DirectoryFrame';

function useDemoMode(): { ready: boolean; allowed: boolean } {
  const { data, isLoading } = useSystemStatus();
  if (isLoading) return { ready: false, allowed: false };
  return { ready: true, allowed: data?.demoMode === true };
}

function Header(): JSX.Element {
  return (
    <header className="mb-5 border-b border-edge pb-3">
      <h1 className="text-xl font-semibold text-foreground">ROK-1870 — Game community hubs</h1>
      <p className="mt-1 text-sm text-secondary">
        A hub for a game with no Pelican server and no WoW guild (e.g. a Baldur&apos;s Gate 3 group). Members propose one
        from the game page, an admin approves it, the proposer leads it, and anyone in the Discord server can Join.
        Mocked data only — nothing here talks to the API.
      </p>
    </header>
  );
}

function Frames(): JSX.Element {
  return (
    <div className="space-y-10">
      <Frame title="1 · Game page — Community hubs card + proposal form" note="Card sits under the game's plugin sections. Start opens a Modal on desktop, a BottomSheet on phone (§4.4). Phone shows the empty state.">
        <GameCardFrames />
      </Frame>
      <Frame title="2 · Admin → Hubs approval queue" note="Pending / Active / Archived. Approve lets the admin tidy the name; Reject needs a reason the proposer sees.">
        <AdminQueueFrames />
      </Frame>
      <Frame title="3 · The community hub page" note="Overview, Members, Events (+ Posts / Resources from the shell). No server or WoW tabs. Switch the viewer to see Join vs Leave vs officer actions.">
        <HubPageFrames />
      </Frame>
      <Frame title="4 · /hubs directory" note="Funnel standard: toolbar trigger + inline panel ≥1024px, neutral Filters FAB + sheet below. Join is inline on each card.">
        <DirectoryFrames />
      </Frame>
    </div>
  );
}

/** DEMO_MODE-gated wireframe page — see file-level docstring. */
export function CommunityHubWireframesPage(): JSX.Element | null {
  const { ready, allowed } = useDemoMode();
  const [sideBySide, setSideBySide] = useState(false);
  useForcedDarkRoot(sideBySide);
  if (!ready) return null;
  if (!allowed) return <Navigate to="/" replace />;
  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <Header />
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <SchemeSwitcher />
        <SideBySideToggle active={sideBySide} onToggle={() => setSideBySide((v) => !v)} />
      </div>
      {sideBySide ? <DualFamily><Frames /></DualFamily> : <Frames />}
    </div>
  );
}
