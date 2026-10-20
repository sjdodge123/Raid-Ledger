/**
 * ROK-1870 wireframe — the community hub page (spec §3.1): hero with the
 * Join pill, Overview (ROK-1868 latest leader post), Members (Join / Leave /
 * Remove / Ban by role) and Events. No server or WoW tabs. The viewer switch
 * shows the visitor, member and officer views of the same hub.
 */
import { useState, type JSX } from 'react';
import { Button } from '../../components/ui/button';
import { StatusChip } from '../../components/ui/status-chip';
import { Card, Device } from './wf-bits';
import { EVENTS, GAME_NAME, LEADER_POST, MEMBERS, type MockMember } from './community-hub-mock';

type Viewer = 'visitor' | 'member' | 'officer';
type Tab = 'overview' | 'members' | 'events';
const TABS: readonly { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' }, { id: 'members', label: 'Members' }, { id: 'events', label: 'Events' },
];

function Hero({ viewer }: { viewer: Viewer }): JSX.Element {
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-3">
        <div className="h-12 w-12 shrink-0 rounded-lg bg-panel" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted">{GAME_NAME}</p>
          <h3 className="truncate text-xl font-semibold text-foreground">Tavern Regulars</h3>
          <p className="text-sm text-secondary">Honour-mode runs on Friday nights. New players welcome.</p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <StatusChip tone="neutral" title="A community hub — open to anyone in the Discord server">Community hub</StatusChip>
        <span className="text-xs text-muted">14 members · Leader Mirelle</span>
        <span className="flex-1" />
        {viewer === 'visitor' ? <Button variant="primary" size="sm">Join</Button>
          : <><StatusChip tone="success" title="You are a member">Joined</StatusChip><Button variant="ghost" size="sm">Leave</Button></>}
      </div>
    </Card>
  );
}

function TabStrip({ active, onPick }: { active: Tab; onPick: (t: Tab) => void }): JSX.Element {
  return (
    <div className="flex gap-4 overflow-x-auto border-b border-edge" role="tablist">
      {TABS.map((t) => (
        <Button key={t.id} variant="bare" role="tab" aria-selected={active === t.id} onClick={() => onPick(t.id)}
          className={`-mb-px border-b-2 px-1 pb-2 text-sm ${active === t.id ? 'border-success font-semibold text-foreground' : 'border-transparent text-muted'}`}>
          {t.label}
        </Button>
      ))}
    </div>
  );
}

function Overview(): JSX.Element {
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <Card className="lg:col-span-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted">Latest post</p>
        <p className="mt-2 whitespace-pre-line text-sm text-secondary">{LEADER_POST.body}</p>
        <p className="mt-2 text-xs text-muted">{LEADER_POST.author} · {LEADER_POST.when}</p>
        <a href="#posts" className="mt-2 inline-block text-sm text-secondary underline">Previous posts</a>
      </Card>
      <Card><p className="text-sm font-semibold text-foreground">Next event</p><p className="text-sm text-secondary">{EVENTS[0]?.title} — {EVENTS[0]?.when}</p></Card>
      <Card><p className="text-sm font-semibold text-foreground">Discord</p><p className="text-sm text-secondary">#tavern-regulars · 3 new messages</p></Card>
    </div>
  );
}

function memberActions(viewer: Viewer, m: MockMember): JSX.Element | null {
  if (viewer !== 'officer' || m.role !== 'Member') return null;
  return (
    <div className="flex gap-1">
      <Button variant="ghost" size="sm">Remove</Button>
      <Button variant="destructive-soft" size="sm">Ban…</Button>
    </div>
  );
}

function Members({ viewer }: { viewer: Viewer }): JSX.Element {
  if (viewer === 'visitor') {
    return <Card><p className="text-sm text-muted">Join to see who&apos;s here.</p><div className="mt-3"><Button variant="primary" size="sm">Join</Button></div></Card>;
  }
  return (
    <Card>
      <ul className="divide-y divide-edge-subtle">
        {MEMBERS.map((m) => (
          <li key={m.name} className="flex items-center gap-3 py-2">
            <div className="h-8 w-8 shrink-0 rounded-full bg-panel" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate text-sm text-foreground">{m.name}</span>
            <StatusChip tone={m.role === 'Member' ? 'neutral' : 'success'} title={`Hub role: ${m.role}`}>{m.role}</StatusChip>
            <span className="hidden text-xs text-muted sm:inline">Joined {m.joined}</span>
            {memberActions(viewer, m)}
          </li>
        ))}
      </ul>
      {viewer === 'officer' && <p className="mt-2 text-xs text-muted">Officers remove or ban members. Only the leader manages officers.</p>}
    </Card>
  );
}

function Events(): JSX.Element {
  return (
    <Card>
      <ul className="divide-y divide-edge-subtle">
        {EVENTS.map((e) => (
          <li key={e.title} className="flex items-center gap-3 py-2">
            <div className="min-w-0 flex-1"><p className="text-sm text-foreground">{e.title}</p><p className="text-xs text-muted">{e.when}</p></div>
            <span className="text-xs text-muted">{e.going} going</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function HubPage({ viewer }: { viewer: Viewer }): JSX.Element {
  const [tab, setTab] = useState<Tab>('overview');
  return (
    <div className="space-y-3">
      <Hero viewer={viewer} />
      <TabStrip active={tab} onPick={setTab} />
      {tab === 'overview' && <Overview />}
      {tab === 'members' && <Members viewer={viewer} />}
      {tab === 'events' && <Events />}
    </div>
  );
}

export function HubPageFrames(): JSX.Element {
  const [viewer, setViewer] = useState<Viewer>('officer');
  return (
    <div className="w-full space-y-3">
      <div className="flex flex-wrap gap-2">
        {(['visitor', 'member', 'officer'] as const).map((v) => (
          <Button key={v} size="sm" variant={viewer === v ? 'primary' : 'secondary'} onClick={() => setViewer(v)}>View as {v}</Button>
        ))}
      </div>
      <div className="flex flex-wrap items-start gap-6">
        <Device kind="desktop"><HubPage viewer={viewer} /></Device>
        <Device kind="phone"><HubPage viewer={viewer} /></Device>
      </div>
    </div>
  );
}
