/**
 * ROK-1870 wireframe — Admin → Hubs (spec §3.5): Pending / Active / Archived,
 * Approve (editable name) and Reject (reason required). Phone stacks each row
 * into a card with its actions underneath.
 */
import { useState, type JSX } from 'react';
import { Button } from '../../components/ui/button';
import { Field } from '../../components/ui/field';
import { Textarea } from '../../components/ui/textarea';
import { StatusChip } from '../../components/ui/status-chip';
import { Card, Device, ModalMock } from './wf-bits';
import { HUBS, PROPOSALS, type MockProposal } from './community-hub-mock';

const TABS = [
  { id: 'pending', label: `Pending (${PROPOSALS.length})` },
  { id: 'active', label: 'Active' },
  { id: 'archived', label: 'Archived' },
] as const;
type TabId = (typeof TABS)[number]['id'];

function Tabs({ active, onPick }: { active: TabId; onPick: (id: TabId) => void }): JSX.Element {
  return (
    <div className="flex gap-4 border-b border-edge" role="tablist">
      {TABS.map((t) => (
        <Button key={t.id} variant="bare" role="tab" aria-selected={active === t.id} onClick={() => onPick(t.id)}
          className={`-mb-px border-b-2 px-1 pb-2 text-sm ${active === t.id ? 'border-success font-semibold text-foreground' : 'border-transparent text-muted'}`}>
          {t.label}
        </Button>
      ))}
    </div>
  );
}

function PendingRow({ p }: { p: MockProposal }): JSX.Element {
  return (
    <li className="flex flex-col gap-2 py-3 @lg:flex-row @lg:items-center @lg:gap-4">
      <div className="min-w-0 flex-1">
        <p className="text-xs text-muted">{p.game}</p>
        <p className="text-sm font-medium text-foreground">{p.name}</p>
        <p className="text-xs text-secondary">{p.blurb}</p>
        <p className="mt-1 text-xs text-muted">Proposed by {p.proposer} · {p.submitted}</p>
      </div>
      <div className="flex gap-2">
        <Button variant="success-soft" size="sm">Approve</Button>
        <Button variant="destructive-soft" size="sm">Reject</Button>
      </div>
    </li>
  );
}

function ActiveRows(): JSX.Element {
  return (
    <ul className="divide-y divide-edge-subtle">
      {HUBS.slice(0, 3).map((h, i) => (
        <li key={h.id} className="flex flex-col gap-2 py-3 @lg:flex-row @lg:items-center @lg:gap-4">
          <div className="min-w-0 flex-1">
            <p className="text-xs text-muted">{h.game}</p>
            <p className="text-sm font-medium text-foreground">{h.name}</p>
            <p className="text-xs text-muted">{h.members} members · Leader {i === 2 ? '—' : h.leader}</p>
          </div>
          {i === 2 && <StatusChip tone="warning" title="The leader left the Discord server">No leader</StatusChip>}
          <div className="flex gap-2">
            <Button variant="secondary" size="sm">Transfer leader</Button>
            <Button variant="destructive-soft" size="sm">Archive</Button>
          </div>
        </li>
      ))}
    </ul>
  );
}

function Queue({ tab, onPick }: { tab: TabId; onPick: (id: TabId) => void }): JSX.Element {
  return (
    <Card>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-lg font-semibold text-foreground">Hubs</h3>
        <Button variant="primary" size="sm">Create hub</Button>
      </div>
      <Tabs active={tab} onPick={onPick} />
      {tab === 'pending' && <ul className="divide-y divide-edge-subtle">{PROPOSALS.map((p) => <PendingRow key={p.id} p={p} />)}</ul>}
      {tab === 'active' && <ActiveRows />}
      {tab === 'archived' && <p className="py-6 text-center text-sm text-muted">No archived hubs.</p>}
    </Card>
  );
}

function RejectDialog(): JSX.Element {
  return (
    <ModalMock title="Reject “Dark Urge Book Club”?"
      footer={<><Button variant="ghost">Cancel</Button><Button variant="destructive">Reject proposal</Button></>}>
      <p className="text-sm text-secondary">Tamsin gets a notification with your reason. The proposal is removed.</p>
      <Field label="Reason" required>
        <Textarea defaultValue="We already have Tavern Regulars for evil runs — try joining that one first." maxLength={500} showCount rows={3} />
      </Field>
    </ModalMock>
  );
}

export function AdminQueueFrames(): JSX.Element {
  const [tab, setTab] = useState<TabId>('pending');
  return (
    <>
      <Device kind="desktop">
        <div className="space-y-4"><Queue tab={tab} onPick={setTab} /><RejectDialog /></div>
      </Device>
      <Device kind="phone"><Queue tab={tab} onPick={setTab} /></Device>
    </>
  );
}
