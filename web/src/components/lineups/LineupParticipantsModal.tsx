/**
 * Read-only lineup participant roster modal (ROK-1346).
 *
 * Lists every participant/invitee with avatar, display name, a role chip
 * (Creator / Invitee / Participant) and a status chip (Voted / Nominated /
 * Waiting), reusing the shared `ui/modal.tsx` (focus trap + Esc + ARIA dialog)
 * and the `InviteeList` row idiom. No add/remove controls — read-only.
 *
 * Avatar resolution mirrors the scheduling-votes participant shape
 * (`avatar` + `customAvatarUrl` + `discordId`) via `toAvatarUser`.
 */
import { type JSX } from 'react';
import type { LineupParticipantDto } from '@raid-ledger/contract';
import { Modal } from '../ui/modal';
import { AvatarWithFallback } from '../shared/AvatarWithFallback';
import { toAvatarUser } from '../../lib/avatar';

interface LineupParticipantsModalProps {
  isOpen: boolean;
  onClose: () => void;
  participants: LineupParticipantDto[];
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
}

const ROLE_LABELS: Record<LineupParticipantDto['role'], string> = {
  creator: 'Creator',
  invitee: 'Invitee',
  participant: 'Participant',
};

const STATUS_LABELS: Record<LineupParticipantDto['status'], string> = {
  voted: 'Voted',
  nominated: 'Nominated',
  waiting: 'Waiting',
};

const STATUS_CLS: Record<LineupParticipantDto['status'], string> = {
  voted: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  nominated: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  waiting: 'bg-overlay/40 text-muted border-edge',
};

/** A single roster row: avatar + name + role chip + status chip + Steam badge. */
function ParticipantRow({
  participant,
}: {
  participant: LineupParticipantDto;
}): JSX.Element {
  return (
    <li
      data-testid="lineup-participant-row"
      className="flex items-center gap-3 px-2 py-2 rounded border border-edge bg-panel"
    >
      <AvatarWithFallback
        user={toAvatarUser({
          id: participant.userId,
          avatar: participant.avatar,
          discordId: participant.discordId,
          customAvatarUrl: participant.customAvatarUrl,
        })}
        username={participant.displayName}
        sizeClassName="w-8 h-8"
      />
      <span className="flex-1 min-w-0 truncate text-sm text-foreground">
        {participant.displayName}
      </span>
      {participant.steamLinked && (
        <span title="Steam account linked" className="text-[10px] text-muted">
          Steam
        </span>
      )}
      <span className="text-[10px] uppercase tracking-wide text-muted">
        {ROLE_LABELS[participant.role]}
      </span>
      <span
        className={`inline-flex items-center px-2 py-0.5 text-[10px] rounded-full border ${STATUS_CLS[participant.status]}`}
      >
        {STATUS_LABELS[participant.status]}
      </span>
    </li>
  );
}

/** Render the modal body for the current query state. */
function ModalBody({
  participants,
  isLoading,
  isError,
  onRetry,
}: Omit<LineupParticipantsModalProps, 'isOpen' | 'onClose'>): JSX.Element {
  if (isLoading) {
    return (
      <div className="text-sm text-muted" data-testid="participants-loading">
        Loading participants…
      </div>
    );
  }
  if (isError) {
    return (
      <div className="text-sm text-red-400" data-testid="participants-error">
        Couldn’t load participants.{' '}
        <button
          type="button"
          onClick={onRetry}
          className="underline hover:text-red-300"
        >
          Retry
        </button>
      </div>
    );
  }
  if (participants.length === 0) {
    return (
      <div className="text-sm text-muted italic">No participants yet.</div>
    );
  }
  return (
    <ul className="flex flex-col gap-2">
      {participants.map((p) => (
        <ParticipantRow key={p.userId} participant={p} />
      ))}
    </ul>
  );
}

export function LineupParticipantsModal({
  isOpen,
  onClose,
  participants,
  isLoading,
  isError,
  onRetry,
}: LineupParticipantsModalProps): JSX.Element | null {
  if (!isOpen) return null;
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Participants">
      <div data-testid="lineup-participants-modal">
        <ModalBody
          participants={participants}
          isLoading={isLoading}
          isError={isError}
          onRetry={onRetry}
        />
      </div>
    </Modal>
  );
}
