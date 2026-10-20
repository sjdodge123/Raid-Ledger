/**
 * ROK-1870 wireframe — the `/hubs` directory (spec §3.4) on the funnel
 * standard (design-system §4.1): search + toolbar funnel with an inline panel
 * on desktop; a neutral Filters FAB opening a sheet on phone. Cards carry the
 * game, name, member count and an inline Join.
 */
import { useState, type JSX } from 'react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { StatusChip } from '../../components/ui/status-chip';
import { Card, Device, FilterFabMock, FunnelTriggerMock, SheetMock } from './wf-bits';
import { GAME_NAME, HUBS, type MockHub } from './community-hub-mock';

function HubCard({ hub }: { hub: MockHub }): JSX.Element {
  return (
    <Card className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <div className="h-6 w-6 shrink-0 rounded bg-panel" aria-hidden="true" />
        <span className="truncate text-xs text-muted">{hub.game}</span>
      </div>
      <a href="#hub" className="text-base font-semibold text-foreground hover:underline">{hub.name}</a>
      <p className="line-clamp-2 text-sm text-secondary">{hub.blurb}</p>
      <div className="mt-auto flex items-center gap-2 pt-1">
        <span className="flex-1 text-xs text-muted">{hub.members} members · {hub.leader}</span>
        {hub.viewer === 'not-member'
          ? <Button variant="secondary" size="sm">Join</Button>
          : <StatusChip tone="success" title="You are in this hub">{hub.viewer === 'leader' ? 'Leader' : 'Joined'}</StatusChip>}
      </div>
    </Card>
  );
}

function PanelBody(): JSX.Element {
  return (
    <div className="grid gap-4 @lg:grid-cols-3">
      <div><p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">Game</p><Input defaultValue={GAME_NAME} fieldSize="sm" aria-label="Game" /></div>
      <div>
        <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">Membership</p>
        <p className="text-sm text-secondary">● All  ○ Joined  ○ Not joined</p>
      </div>
      <div><p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">Sort</p><p className="text-sm text-secondary">Most members ▾</p></div>
    </div>
  );
}

function InlinePanel({ onClear }: { onClear: () => void }): JSX.Element {
  return (
    <div className="rounded-lg border border-edge bg-panel p-4">
      <div className="mb-3 flex items-center justify-between">
        <h4 className="text-sm font-semibold text-foreground">Filters</h4>
        <Button variant="ghost" size="sm" onClick={onClear}>Clear all</Button>
      </div>
      <PanelBody />
    </div>
  );
}

function Grid({ hubs, cols }: { hubs: readonly MockHub[]; cols: string }): JSX.Element {
  if (hubs.length === 0) {
    return <Card><p className="text-center text-sm text-muted">No hubs match — clear filters to see all hubs.</p></Card>;
  }
  return <div className={`grid gap-3 ${cols}`}>{hubs.map((h) => <HubCard key={h.id} hub={h} />)}</div>;
}

function Header(): JSX.Element {
  return (
    <div>
      <h3 className="text-xl font-semibold text-foreground">Community hubs</h3>
      <p className="text-sm text-muted">Groups for the games we play. Join any of them.</p>
    </div>
  );
}

function Desktop({ filtered, setFiltered }: { filtered: boolean; setFiltered: (v: boolean) => void }): JSX.Element {
  const [open, setOpen] = useState(true);
  const hubs = filtered ? HUBS.filter((h) => h.game === GAME_NAME) : HUBS;
  return (
    <div className="space-y-3">
      <Header />
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1"><Input placeholder="Search hubs" aria-label="Search hubs" fieldSize="sm" /></div>
        <FunnelTriggerMock active={filtered ? 1 : 0} open={open} onClick={() => setOpen(!open)} />
      </div>
      {open && <InlinePanel onClear={() => setFiltered(false)} />}
      <Grid hubs={hubs} cols="grid-cols-2 @xl:grid-cols-3" />
      <div className="flex justify-center"><Button variant="secondary" size="sm">Load more</Button></div>
    </div>
  );
}

function Phone({ filtered, setFiltered }: { filtered: boolean; setFiltered: (v: boolean) => void }): JSX.Element {
  const [sheet, setSheet] = useState(false);
  const hubs = filtered ? HUBS.filter((h) => h.game === GAME_NAME) : HUBS;
  if (sheet) {
    return (
      <SheetMock title="Filters" footer={<><Button variant="ghost" fullWidth onClick={() => setFiltered(false)}>Clear all</Button><Button variant="primary" fullWidth onClick={() => setSheet(false)}>Show hubs</Button></>}>
        <PanelBody />
      </SheetMock>
    );
  }
  return (
    <div className="min-h-[520px] space-y-3 pb-20">
      <Header />
      <Input placeholder="Search hubs" aria-label="Search hubs" fieldSize="sm" />
      <Grid hubs={hubs} cols="grid-cols-1" />
      <FilterFabMock active={filtered ? 1 : 0} onClick={() => setSheet(true)} />
    </div>
  );
}

export function DirectoryFrames(): JSX.Element {
  const [filtered, setFiltered] = useState(true);
  return (
    <>
      <Device kind="desktop"><Desktop filtered={filtered} setFiltered={setFiltered} /></Device>
      <Device kind="phone"><Phone filtered={filtered} setFiltered={setFiltered} /></Device>
    </>
  );
}
