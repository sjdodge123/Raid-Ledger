/**
 * Creator/operator "Remove Participant" action for the scheduling poll's
 * Manage shells (ROK-2020). The counterpart of Add Participants: a mistaken
 * add (or someone who dropped out) otherwise stays in the denominator and in
 * "Remind voters" forever.
 *
 * A Manage row only (§4.14) — both the phone sheet and the desktop menu render
 * it. It opens a `Modal` listing the poll roster minus the creator (the API
 * refuses the creator with a 400 — Cancel Poll owns that case); picking a
 * person swaps the body to a confirm. Gated exactly like Add Participants
 * (`canBypassThreshold` = lineup creator OR admin/operator), hidden in
 * read-only polls. The shared `LineupParticipantsModal` stays read-only.
 *
 * Removal is not a ban: slot voting re-enrols anyone who votes again.
 */
import { useState, type JSX } from 'react';
import type {
  LineupParticipantDto,
  MatchDetailResponseDto,
} from '@raid-ledger/contract';
import { Modal } from '../../ui/modal';
import { Button } from '../../ui/button';
import { AvatarWithFallback } from '../../shared/AvatarWithFallback';
import { toAvatarUser } from '../../../lib/avatar';
import { useAuth } from '../../../hooks/use-auth';
import { useLineupParticipants } from '../../../hooks/use-lineups';
import { useRemovePollMember } from '../../../hooks/use-remove-poll-member';
import { canBypassThreshold } from '../../../pages/scheduling/threshold';
import { SchedulingSheetRow } from './scheduling-sheet-row';

export interface SchedulingRemoveMemberActionProps {
  lineupId: number;
  matchId: number;
  match: MatchDetailResponseDto;
  readOnly: boolean;
}

/** The Manage row + its modal — see file-level docstring. */
export function SchedulingRemoveMemberAction(
  props: SchedulingRemoveMemberActionProps,
): JSX.Element | null {
  const { lineupId, matchId, match, readOnly } = props;
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  if (!canBypassThreshold(user, match) || readOnly) return null;
  return (
    <>
      <SchedulingSheetRow
        title="Remove Participant"
        subline="take someone off this poll"
        onClick={() => setOpen(true)}
        testId="remove-poll-member-button"
      />
      {open && (
        <RemoveMemberModal
          lineupId={lineupId}
          matchId={matchId}
          creatorId={match.lineupCreatedById}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

interface ModalProps {
  lineupId: number;
  matchId: number;
  creatorId: number | null | undefined;
  onClose: () => void;
}

/** Pick → confirm. Not closable while the DELETE is in flight. */
function RemoveMemberModal(props: ModalProps): JSX.Element {
  const { lineupId, matchId, creatorId, onClose } = props;
  const [target, setTarget] = useState<LineupParticipantDto | null>(null);
  const remove = useRemovePollMember();
  const pending = remove.isPending;
  const confirm = (): void => {
    if (!target) return;
    const { userId, displayName } = target;
    remove.mutate(
      { lineupId, matchId, userId, displayName },
      // The hook already toasted + restored the roster; back to the list.
      { onSuccess: onClose, onError: () => setTarget(null) },
    );
  };
  const footer = target ? (
    <ConfirmFooter onCancel={() => setTarget(null)} onConfirm={confirm} isPending={pending} />
  ) : undefined;
  const guardedClose = (): void => {
    if (!pending) onClose();
  };
  return (
    <Modal isOpen onClose={guardedClose} title="Remove Participant" footer={footer}>
      {target ? (
        <ConfirmBody name={target.displayName} />
      ) : (
        <PickList lineupId={lineupId} matchId={matchId} creatorId={creatorId} onPick={setTarget} />
      )}
    </Modal>
  );
}

/** The poll roster minus the creator, one Remove button per person. */
function PickList(
  props: Omit<ModalProps, 'onClose'> & { onPick: (p: LineupParticipantDto) => void },
): JSX.Element {
  const { lineupId, matchId, creatorId, onPick } = props;
  const roster = useLineupParticipants(lineupId, matchId);
  if (roster.isLoading) {
    return <p className="text-sm text-muted">Loading participants…</p>;
  }
  if (roster.isError) {
    return <p className="text-sm text-danger">Couldn’t load participants.</p>;
  }
  const rows = (roster.data?.participants ?? []).filter(
    (p) => p.role !== 'creator' && p.userId !== creatorId,
  );
  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted italic" data-testid="remove-poll-member-empty">
        Nobody to remove yet. Only the creator is on this poll.
      </p>
    );
  }
  return (
    <ul className="flex flex-col gap-2" data-testid="remove-poll-member-list">
      {rows.map((p) => (
        <PickRow key={p.userId} participant={p} onPick={onPick} />
      ))}
    </ul>
  );
}

function PickRow({
  participant: p,
  onPick,
}: {
  participant: LineupParticipantDto;
  onPick: (p: LineupParticipantDto) => void;
}): JSX.Element {
  const { userId: id, avatar, discordId, customAvatarUrl } = p;
  const user = toAvatarUser({ id, avatar, discordId, customAvatarUrl });
  return (
    <li className="flex items-center gap-3 px-2 py-2 rounded border border-edge bg-panel">
      <AvatarWithFallback user={user} username={p.displayName} sizeClassName="w-8 h-8" />
      <span className="flex-1 min-w-0 truncate text-sm text-foreground">{p.displayName}</span>
      <Button
        variant="destructive-soft"
        size="sm"
        aria-label={`Remove ${p.displayName}`}
        data-testid={`remove-poll-member-${p.userId}`}
        onClick={() => onPick(p)}
      >
        Remove
      </Button>
    </li>
  );
}

function ConfirmBody({ name }: { name: string }): JSX.Element {
  return (
    <p className="text-sm text-secondary" data-testid="remove-poll-member-confirm-body">
      Remove <strong className="text-foreground">{name}</strong> from this poll?
      Their votes on this poll are deleted too. They can rejoin by voting.
    </p>
  );
}

function ConfirmFooter(props: {
  onCancel: () => void;
  onConfirm: () => void;
  isPending: boolean;
}): JSX.Element {
  const { onCancel, onConfirm, isPending } = props;
  return (
    <div className="flex justify-end gap-3">
      <Button variant="secondary" onClick={onCancel} disabled={isPending}>
        Cancel
      </Button>
      <Button
        variant="destructive"
        onClick={onConfirm}
        loading={isPending}
        loadingLabel="Removing…"
        data-testid="remove-poll-member-confirm"
      >
        Remove
      </Button>
    </div>
  );
}
