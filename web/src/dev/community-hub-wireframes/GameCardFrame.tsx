/**
 * ROK-1870 wireframe — the game page's card (spec §3.2; ROK-1883: the one "Hubs" card) and
 * the proposal form (§3.3): `Modal` on desktop, `BottomSheet` on phone.
 */
import type { JSX } from 'react';
import { Button } from '../../components/ui/button';
import { Field } from '../../components/ui/field';
import { Input } from '../../components/ui/input';
import { Textarea } from '../../components/ui/textarea';
import { StatusChip } from '../../components/ui/status-chip';
import { Card, Device, ModalMock, SheetMock } from './wf-bits';
import type { GuildKind } from '@raid-ledger/contract';
import { HubKindChip } from '../../components/layout/hub-nav/hub-kind-chip';
import { GAME_NAME, HUBS, MY_PROPOSAL, type MockHub } from './community-hub-mock';

/** ROK-1883: the one Hubs card lists every kind — joined first, then others up to three. */
interface CardHub { id: number; name: string; meta: string; kind: GuildKind; viewer: MockHub['viewer']; hidden?: boolean }

const GAME_HUBS: readonly CardHub[] = [
  { id: 901, name: 'Lantern Watch', meta: '38 members · Whitemane · Alliance raiding guild', kind: 'wow_guild', viewer: 'member' },
  { id: 902, name: 'Forever Test Realm', meta: '12 members · Our dedicated realm server', kind: 'game_server', viewer: 'member', hidden: true },
  ...HUBS.filter((h) => h.game === GAME_NAME).slice(0, 1).map((h): CardHub => ({
    id: h.id, name: h.name, meta: `${h.members} members · ${h.blurb}`, kind: 'game_community', viewer: 'not-member',
  })),
];

function HubAction({ hub }: { hub: CardHub }): JSX.Element {
  if (hub.kind !== 'game_community') return <Button variant="secondary" size="sm">View</Button>;
  return hub.viewer === 'member'
    ? <StatusChip tone="success" title="You are in this hub">Joined</StatusChip>
    : <Button variant="secondary" size="sm">Join</Button>;
}

function HubRow({ hub }: { hub: CardHub }): JSX.Element {
  return (
    <li className="flex items-center gap-3 py-2">
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
        <div className="min-w-0 basis-full sm:flex-1 sm:basis-auto">
          <p className="truncate text-sm font-medium text-foreground">{hub.name}</p>
          <p className="truncate text-xs text-muted">{hub.meta}</p>
        </div>
        <span className="flex shrink-0 items-center gap-1.5">
          <HubKindChip kind={hub.kind} />
          {hub.hidden && <StatusChip tone="warning" title="Hidden — only admins and operators can see this hub">Hidden</StatusChip>}
        </span>
      </div>
      <HubAction hub={hub} />
    </li>
  );
}

function ProposalRow(): JSX.Element {
  return (
    <li className="flex items-center gap-3 py-2">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{MY_PROPOSAL.name}</p>
        <p className="truncate text-xs text-muted">Sent {MY_PROPOSAL.submitted}</p>
      </div>
      <StatusChip tone="warning" title="An admin has not reviewed it yet">Pending review</StatusChip>
      <Button variant="ghost" size="sm">Withdraw</Button>
    </li>
  );
}

/** ROK-1883 — the game page's one Hubs card (staff view: one hidden server hub). */
export function GameHubsCard({ empty = false }: { empty?: boolean }): JSX.Element {
  return (
    <Card>
      <h3 className="text-lg font-semibold text-foreground">Hubs</h3>
      {empty ? (
        <p className="mt-2 text-sm text-muted">No hubs for {GAME_NAME} yet — start the first community hub.</p>
      ) : (
        <ul className="mt-1 divide-y divide-edge-subtle">{GAME_HUBS.map((h) => <HubRow key={h.id} hub={h} />)}</ul>
      )}
      {!empty && <a href="#directory" className="mt-1 inline-block text-sm text-secondary underline">See all 5 hubs</a>}
      <p className="mt-4 text-xs font-medium uppercase tracking-wide text-muted">Your proposals</p>
      <ul className="divide-y divide-edge-subtle"><ProposalRow /></ul>
      <div className="mt-3"><Button variant="secondary">Start a community hub</Button></div>
    </Card>
  );
}

function ProposalFields(): JSX.Element {
  return (
    <>
      <p className="text-sm text-secondary">Game: <span className="font-medium text-foreground">{GAME_NAME}</span></p>
      <Field label="Hub name" hint="3–64 characters. Must be unique for this game.">
        <Input defaultValue="Dark Urge Book Club" maxLength={64} />
      </Field>
      <Field label="Short description">
        <Textarea defaultValue="Evil playthroughs, one chapter a week, lore chat after." maxLength={280} showCount rows={3} />
      </Field>
      <p className="text-xs text-muted">An admin reviews new hubs — usually within a day. You&apos;ll lead it once approved.</p>
    </>
  );
}

function FormFooter({ full = false }: { full?: boolean }): JSX.Element {
  return (
    <>
      <Button variant="ghost" fullWidth={full}>Cancel</Button>
      <Button variant="primary" fullWidth={full}>Send for review</Button>
    </>
  );
}

export function GameCardFrames(): JSX.Element {
  return (
    <>
      <Device kind="desktop">
        <div className="space-y-4">
          <GameHubsCard />
          <ModalMock title="Start a community hub" footer={<FormFooter />}><ProposalFields /></ModalMock>
        </div>
      </Device>
      <Device kind="phone">
        <div className="space-y-4">
          <GameHubsCard empty />
          <SheetMock title="Start a community hub" footer={<FormFooter full />}><ProposalFields /></SheetMock>
        </div>
      </Device>
    </>
  );
}
