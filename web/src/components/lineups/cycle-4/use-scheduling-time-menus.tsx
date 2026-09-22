/**
 * Builds the ⋯ menu for EVERY time card on the scheduling page (ROK-1635 AC3).
 *
 * Its own module for two reasons. First, `SchedulingComposite` is against its
 * 300-line cap (§4.8) and this wiring — per-slot audience counts, the
 * expired-poll lock rule, the past-time gate — is a paragraph of it. Second,
 * the Rally cooldown is per POLL (6h, §3.4): ONE `useArmedCooldown()` is
 * created here and handed to every menu, so the first successful rally leaves
 * the leading card AND every row reading "Rallied ✓ / You can do this again in
 * 6h" instead of N independently-idle buttons the server would 429.
 */
import type { JSX } from 'react';
import type {
  ScheduleSlotWithVotesDto,
  SchedulePollPageResponseDto,
} from '@raid-ledger/contract';
import { SchedulingTimeMenu } from './SchedulingTimeMenu';
import { rallyPendingCount } from './scheduling-manage.helpers';
import { formatSlotTime } from './scheduling-slot-time';
import { useArmedCooldown } from './use-rally-cooldown';

export interface SchedulingTimeMenusArgs {
  poll: SchedulePollPageResponseDto;
  lineupId: number;
  matchId: number;
  readOnly: boolean;
  /** The viewer — never part of their own rally audience. */
  viewerId: number | null;
  /** Operator/creator gate. False → no ⋯ anywhere on the page (OQ-2). */
  canManage: boolean;
  /** The slot the leading card names, or `null` when nothing leads. */
  leaderSlot: ScheduleSlotWithVotesDto | null;
  onLock: (slot: ScheduleSlotWithVotesDto) => void;
}

export interface SchedulingTimeMenus {
  /** The leading card's menu — ROK-1618's `scheduling-leader-*` testids. */
  leaderMenu: JSX.Element | null;
  /** One ladder row's menu — `scheduling-slot-*`, scoped by `data-slot-id`. */
  renderSlotMenu: (slot: ScheduleSlotWithVotesDto) => JSX.Element;
}

/** Every time card's ⋯ menu, sharing one rally cooldown — see docstring. */
export function useSchedulingTimeMenus(
  args: SchedulingTimeMenusArgs,
): SchedulingTimeMenus {
  const { poll, lineupId, matchId, readOnly, viewerId, canManage } = args;
  const { leaderSlot, onLock } = args;
  const cooldown = useArmedCooldown();

  /** Members with no stance on THIS slot — the audience the DM will reach. */
  const pendingFor = (slotId: number): number | undefined =>
    rallyPendingCount({
      members: poll.match.members,
      slots: poll.slots,
      viewerId,
      slotId,
    });

  const build = (
    slot: ScheduleSlotWithVotesDto,
    testIdPrefix: 'scheduling-leader' | 'scheduling-slot',
  ): JSX.Element => {
    const { label, isPast } = formatSlotTime(slot.proposedTime);
    return (
      <SchedulingTimeMenu
        /* Keyed by the time it acts on, NOT by its position. The leading
           card renders ONE menu element at a fixed position, so without a
           key React reconciles a lead swap in place: a popover the organiser
           opened on Wed stays open and its Lock item quietly means Thu.
           Keying it unmounts (and so closes) the menu with its time — the
           guarantee ladder rows already get from their row's own key. */
        key={`${testIdPrefix}-${slot.id}`}
        lineupId={lineupId}
        matchId={matchId}
        slot={slot}
        timeLabel={label}
        canManage={canManage}
        /* No card offers a lock on a time that has already passed — the
           server refuses it. ROK-1610's expired-poll restriction is NOT
           checked here: it only ever names a slot on a `readOnly` poll, and
           this menu renders nothing at all when `readOnly` (the expired
           lock-in is `SchedulingTerminalBanner`'s single action instead). */
        canLock={!isPast}
        /* The server refuses a rally on a past time, so the item is hidden
           rather than offered and toasted at. A card with neither item left
           renders no ⋯ at all. */
        canRally={!isPast}
        readOnly={readOnly}
        pendingVoterCount={pendingFor(slot.id)}
        cooldown={cooldown}
        testIdPrefix={testIdPrefix}
        onLock={() => onLock(slot)}
      />
    );
  };

  return {
    leaderMenu: leaderSlot ? build(leaderSlot, 'scheduling-leader') : null,
    renderSlotMenu: (slot) => build(slot, 'scheduling-slot'),
  };
}
