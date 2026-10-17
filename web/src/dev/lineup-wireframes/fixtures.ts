/**
 * Static fixture data for ROK-1193 lineup wireframes.
 * DEV-ONLY. No API calls — wireframes render even if API is down.
 */

export interface FixtureGame {
  id: number;
  name: string;
  coverColor: string;
  voteCount: number;
  ownerCount: number;
  myVote?: boolean;
}

export interface FixtureMember {
  id: number;
  name: string;
  initial: string;
}

export interface FixtureMatch {
  id: number;
  gameId: number;
  gameName: string;
  coverColor: string;
  voteCount: number;
  members: FixtureMember[];
  threshold: number;
  iJoined?: boolean;
}

export interface FixtureSlot {
  id: number;
  label: string;
  iso: string;
  votes: number;
  myVote?: boolean;
  isQuorum?: boolean;
}

export interface FixtureLineup {
  id: number;
  title: string;
  visibility: 'public' | 'private';
  startedBy: string;
  totalVoters: number;
  totalMembers: number;
  nominatedCount: number;
  maxNominations: number;
  maxVotesPerPlayer: number;
}

export const LINEUP: FixtureLineup = {
  id: 42,
  title: 'Saturday Night Crew',
  visibility: 'public',
  startedBy: 'GuildMaster',
  totalVoters: 7,
  totalMembers: 12,
  nominatedCount: 8,
  maxNominations: 20,
  maxVotesPerPlayer: 3,
};

export const MEMBERS: FixtureMember[] = [
  { id: 1, name: 'Aelina', initial: 'A' },
  { id: 2, name: 'Borin', initial: 'B' },
  { id: 3, name: 'Cassia', initial: 'C' },
  { id: 4, name: 'Drust', initial: 'D' },
  { id: 5, name: 'Elara', initial: 'E' },
  { id: 6, name: 'Faelan', initial: 'F' },
];

export const GAMES: FixtureGame[] = [
  { id: 101, name: 'Hollowforge', coverColor: '#3b82f6', voteCount: 6, ownerCount: 9, myVote: true },
  { id: 102, name: 'Riftbound', coverColor: '#8b5cf6', voteCount: 6, ownerCount: 7, myVote: true },
  { id: 103, name: 'Stonepeak Saga', coverColor: '#10b981', voteCount: 4, ownerCount: 8 },
  { id: 104, name: 'Embershade', coverColor: '#f59e0b', voteCount: 3, ownerCount: 5, myVote: true },
  { id: 105, name: 'Tideborn', coverColor: '#06b6d4', voteCount: 2, ownerCount: 6 },
  { id: 106, name: 'Whisperwood', coverColor: '#ec4899', voteCount: 1, ownerCount: 4 },
  { id: 107, name: 'Ironclad', coverColor: '#64748b', voteCount: 1, ownerCount: 3 },
  { id: 108, name: 'Skyforge', coverColor: '#a855f7', voteCount: 0, ownerCount: 2 },
];

export const MATCHES: FixtureMatch[] = [
  {
    id: 201, gameId: 101, gameName: 'Hollowforge', coverColor: '#3b82f6',
    voteCount: 6,
    members: MEMBERS.slice(0, 5),
    threshold: 4,
  },
  {
    id: 202, gameId: 102, gameName: 'Riftbound', coverColor: '#8b5cf6',
    voteCount: 6,
    members: MEMBERS.slice(2, 5),
    threshold: 4,
  },
  {
    id: 203, gameId: 103, gameName: 'Stonepeak Saga', coverColor: '#10b981',
    voteCount: 4,
    members: MEMBERS.slice(1, 4),
    threshold: 4,
  },
  {
    id: 204, gameId: 104, gameName: 'Embershade', coverColor: '#f59e0b',
    voteCount: 3,
    members: MEMBERS.slice(0, 2),
    threshold: 4,
  },
];

export const SLOTS: FixtureSlot[] = [
  { id: 301, label: 'Sat 7:00 PM', iso: '2026-05-02T19:00:00', votes: 5, myVote: true, isQuorum: true },
  { id: 302, label: 'Fri 8:00 PM', iso: '2026-05-01T20:00:00', votes: 3 },
  { id: 303, label: 'Sun 6:00 PM', iso: '2026-05-03T18:00:00', votes: 2, myVote: true },
];

export const TIEBREAKER_BRACKET = [
  { id: 'm1', a: 'Hollowforge', b: 'Riftbound', myVote: 'a' as const, isComplete: false },
  { id: 'm2', a: 'Stonepeak Saga', b: 'Embershade', myVote: null as null | 'a' | 'b', isComplete: false },
];

export const PAST_LINEUPS = [
  { id: 40, title: 'Friday Night Skirmish', winner: 'Tideborn', participants: 11, decidedAt: '2026-04-12' },
  { id: 41, title: 'Tuesday Test Run', winner: 'Riftbound', participants: 6, decidedAt: '2026-04-08' },
];

export interface PhaseDeadlineDescriptor {
  countdownLabel: string;
  isUrgent: boolean;
  hasExpired: boolean;
}

export function deadlineDescriptor(
  state: 'plenty-of-time' | 'deadline-soon' | 'deadline-missed' | 'phase-complete' | 'aborted',
): PhaseDeadlineDescriptor {
  if (state === 'plenty-of-time') return { countdownLabel: '3d 4h left', isUrgent: false, hasExpired: false };
  if (state === 'deadline-soon') return { countdownLabel: '7h 12m left', isUrgent: true, hasExpired: false };
  if (state === 'deadline-missed') return { countdownLabel: 'Expired 12m ago', isUrgent: true, hasExpired: true };
  return { countdownLabel: '—', isUrgent: false, hasExpired: false };
}
