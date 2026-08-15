/**
 * ROK-1416 — Channel-binding admin wireframe (DEMO_MODE-gated).
 * Design reference for: edit purpose/game on the config form, a net-new create
 * form, and the inline inert-binding repair (the ROK-1415 one-click heal).
 * Redirects to / when demoMode is false. Route: /dev/wireframes/binding-admin
 */
import type { JSX, ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useSystemStatus } from '../../hooks/use-system-status';
import {
  BindingEditBefore, BindingEditAfter,
  InertRowBefore, InertRowAfter,
  CreateBefore, CreateAfter,
} from './binding-admin-mocks';

function useDemoMode(): { ready: boolean; allowed: boolean } {
  const { data, isLoading } = useSystemStatus();
  if (isLoading) return { ready: false, allowed: false };
  return { ready: true, allowed: data?.demoMode === true };
}

function Section({ id, title, delta, why, children }: {
  id: string; title: string; delta: string; why: string; children: ReactNode;
}): JSX.Element {
  return (
    <section id={id} className="mb-12 scroll-mt-4">
      <div className="border-b border-edge pb-2 mb-4">
        <h2 className="text-lg font-semibold text-foreground">{title}</h2>
        <p className="text-sm text-emerald-300 font-mono">{delta}</p>
        <p className="text-xs text-secondary mt-1">{why}</p>
      </div>
      {children}
    </section>
  );
}

function BA({ before, after }: { before: ReactNode; after: ReactNode }): JSX.Element {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div>
        <div className="text-xs uppercase tracking-wider text-red-400 mb-2">BEFORE — today</div>
        <div className="bg-panel/50 border border-red-500/20 rounded-lg p-3">{before}</div>
      </div>
      <div>
        <div className="text-xs uppercase tracking-wider text-emerald-400 mb-2">AFTER — proposed</div>
        <div className="bg-panel/50 border border-emerald-500/30 rounded-lg p-3">{after}</div>
      </div>
    </div>
  );
}

const SECTIONS: Array<{ id: string; title: string; delta: string; why: string; before: JSX.Element; after: JSX.Element }> = [
  {
    id: 'b1', title: 'B1 — Edit purpose + game on the config form',
    delta: '3 fields (minPlayers/autoClose/grace) → purpose selector + game autocomplete + config',
    why: 'Today BindingConfigForm can only edit min-players / auto-close / grace. Purpose and game are set once via /bind and never editable, so a mis-bound channel (the whole #General incident) can only be fixed by Remove + re-/bind in Discord — which also resets config to defaults. Add a purpose selector and a game autocomplete. The game field is shown for Activity Monitor / Announcements and hidden (greyed) for General Lobby. allowJustChatting appears live the instant General Lobby is selected — driven off local state, not the prop, so no page reload (ROK-1416 AC).',
    before: <BindingEditBefore />, after: <BindingEditAfter />,
  },
  {
    id: 'b2', title: 'B2 — Inert-binding detection + one-click repair in the list',
    delta: 'silently-dead row → red INERT badge + "Fix →" guided repair',
    why: 'A voice binding with purpose=Activity Monitor and no game can never spawn Quick Play (ROK-1415), yet today it renders as a healthy-looking row that even advertises "Quick Play." Surface it: a red INERT badge on the row and a one-click "Fix →" that converts it to a General Lobby. This is the same detection that fires the boot-time WARN + Sentry alert — the operator applies the repair here, with guidance. This is the "UI repair" the operator opted into instead of a data-migration.',
    before: <InertRowBefore />, after: <InertRowAfter />,
  },
  {
    id: 'b3', title: 'B3 — Create-binding form (wire the dangling hook)',
    delta: 'dead "…or add one below" copy → working create form',
    why: 'ChannelBindingList already promises "or add one below" and a createBinding hook already exists (use-channel-bindings.ts:16) — but nothing is wired, so it is a dead affordance. Add the form: channel picker, purpose selector, conditional game field (required for Activity Monitor), config. It imports the SAME validateBindingTriple classifier as the edit path, so the create button stays disabled until the (channelType, purpose, game) combo is valid — the UI structurally cannot mint the ROK-1415 broken state.',
    before: <CreateBefore />, after: <CreateAfter />,
  },
];

export function BindingAdminWireframesPage(): JSX.Element | null {
  const { ready, allowed } = useDemoMode();
  if (!ready) return null;
  if (!allowed) return <Navigate to="/" replace />;
  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      <header className="border-b border-edge pb-3 mb-6">
        <h1 className="text-xl font-semibold text-foreground">ROK-1416 — Channel-binding admin: edit + create + repair</h1>
        <p className="text-sm text-secondary mt-1">
          Design reference for editing binding purpose/game, a net-new create form, and the inline inert-binding repair. The invariant (voice+game = Activity Monitor, voice+no-game = General Lobby, text = Announcements) is enforced by a shared <code className="text-foreground bg-overlay px-1 rounded">validateBindingTriple</code> classifier that both create and edit import — the same rule ROK-1415 adds server-side.
        </p>
        <p className="text-xs text-amber-300 mt-1">
          Stories: <code className="text-amber-200">ROK-1416</code> (this UI) · <code className="text-amber-200">ROK-1415</code> (server invariant + inert detection) · Plan: <code className="text-amber-200">planning-artifacts/quickplay-binding-batch-plan.md</code>
        </p>
        <nav className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs">
          {SECTIONS.map(({ id, title }) => (
            <a key={id} href={`#${id}`} className="text-emerald-300 hover:text-emerald-200 underline">{title.split(' — ')[0]}</a>
          ))}
        </nav>
      </header>
      {SECTIONS.map((s) => (
        <Section key={s.id} id={s.id} title={s.title} delta={s.delta} why={s.why}>
          <BA before={s.before} after={s.after} />
        </Section>
      ))}
    </div>
  );
}
