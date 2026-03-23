import type { ActivityActionDto } from '@raid-ledger/contract';

interface ActionDisplay {
  color: string;
  dotColor: string;
  bgColor: string;
  borderColor: string;
  label: (actor: string | null, metadata: Record<string, unknown> | null) => string;
}

const ACTION_MAP: Record<string, ActionDisplay> = {
  // Lineup actions
  lineup_created: {
    color: 'text-emerald-400',
    dotColor: 'bg-emerald-400',
    bgColor: 'bg-emerald-500/20',
    borderColor: 'border-emerald-500/40',
    label: (actor) => `${actor ?? 'System'} started the lineup`,
  },
  game_nominated: {
    color: 'text-blue-400',
    dotColor: 'bg-blue-400',
    bgColor: 'bg-blue-500/20',
    borderColor: 'border-blue-500/40',
    label: (actor, meta) =>
      `${actor ?? 'Someone'} nominated ${(meta?.gameName as string) ?? 'a game'}`,
  },
  nomination_removed: {
    color: 'text-red-400',
    dotColor: 'bg-red-400',
    bgColor: 'bg-red-500/20',
    borderColor: 'border-red-500/40',
    label: (actor, meta) =>
      `${actor ?? 'Someone'} removed ${(meta?.gameName as string) ?? 'a game'}`,
  },
  game_carried_over: {
    color: 'text-amber-400',
    dotColor: 'bg-amber-400',
    bgColor: 'bg-amber-500/20',
    borderColor: 'border-amber-500/40',
    label: (_actor, meta) =>
      `${(meta?.gameName as string) ?? 'A game'} carried over`,
  },
  voting_started: {
    color: 'text-emerald-400',
    dotColor: 'bg-emerald-400',
    bgColor: 'bg-emerald-500/20',
    borderColor: 'border-emerald-500/40',
    label: () => 'Voting started',
  },
  vote_cast: {
    color: 'text-blue-400',
    dotColor: 'bg-blue-400',
    bgColor: 'bg-blue-500/20',
    borderColor: 'border-blue-500/40',
    label: (actor, meta) =>
      `${actor ?? 'Someone'} voted for ${(meta?.gameName as string) ?? 'a game'}`,
  },
  lineup_decided: {
    color: 'text-emerald-400',
    dotColor: 'bg-emerald-400',
    bgColor: 'bg-emerald-500/20',
    borderColor: 'border-emerald-500/40',
    label: (_actor, meta) =>
      `${(meta?.gameName as string) ?? 'A game'} was chosen`,
  },
  event_linked: {
    color: 'text-blue-400',
    dotColor: 'bg-blue-400',
    bgColor: 'bg-blue-500/20',
    borderColor: 'border-blue-500/40',
    label: () => 'Event created from lineup',
  },
  // Event actions
  event_created: {
    color: 'text-emerald-400',
    dotColor: 'bg-emerald-400',
    bgColor: 'bg-emerald-500/20',
    borderColor: 'border-emerald-500/40',
    label: (actor) => `${actor ?? 'System'} created the event`,
  },
  signup_added: {
    color: 'text-blue-400',
    dotColor: 'bg-blue-400',
    bgColor: 'bg-blue-500/20',
    borderColor: 'border-blue-500/40',
    label: (actor, meta) => {
      const role = meta?.role as string | null;
      return role
        ? `${actor ?? 'Someone'} signed up as ${role}`
        : `${actor ?? 'Someone'} signed up`;
    },
  },
  signup_cancelled: {
    color: 'text-red-400',
    dotColor: 'bg-red-400',
    bgColor: 'bg-red-500/20',
    borderColor: 'border-red-500/40',
    label: (actor) => `${actor ?? 'Someone'} cancelled their signup`,
  },
  roster_allocated: {
    color: 'text-amber-400',
    dotColor: 'bg-amber-400',
    bgColor: 'bg-amber-500/20',
    borderColor: 'border-amber-500/40',
    label: () => 'Roster was allocated',
  },
  event_cancelled: {
    color: 'text-red-400',
    dotColor: 'bg-red-400',
    bgColor: 'bg-red-500/20',
    borderColor: 'border-red-500/40',
    label: (actor) => `${actor ?? 'System'} cancelled the event`,
  },
  event_rescheduled: {
    color: 'text-amber-400',
    dotColor: 'bg-amber-400',
    bgColor: 'bg-amber-500/20',
    borderColor: 'border-amber-500/40',
    label: (actor) => `${actor ?? 'System'} rescheduled the event`,
  },
};

const FALLBACK: ActionDisplay = {
  color: 'text-muted',
  dotColor: 'bg-muted',
  bgColor: 'bg-panel',
  borderColor: 'border-edge',
  label: () => 'Activity',
};

export function getActionDisplay(action: ActivityActionDto): ActionDisplay {
  return ACTION_MAP[action] ?? FALLBACK;
}

export function formatTimelineDate(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60_000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;

  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  return date.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }) + ' \u00B7 ' + date.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });
}
