/**
 * ROK-1870 — mocked data for the community-hub wireframe. Nothing here talks
 * to the API; names are invented (no real players or groups).
 */
export interface MockHub {
  id: number;
  game: string;
  name: string;
  blurb: string;
  members: number;
  leader: string;
  viewer: 'member' | 'leader' | 'not-member' | 'banned';
}

export interface MockMember {
  name: string;
  role: 'Leader' | 'Officer' | 'Member';
  joined: string;
}

export interface MockProposal {
  id: number;
  game: string;
  name: string;
  blurb: string;
  proposer: string;
  submitted: string;
}

export const GAME_NAME = "Baldur's Gate 3";

export const HUBS: readonly MockHub[] = [
  { id: 1, game: GAME_NAME, name: 'Tavern Regulars', blurb: 'Honour-mode runs on Friday nights. New players welcome, bring snacks.', members: 14, leader: 'Mirelle', viewer: 'member' },
  { id: 2, game: GAME_NAME, name: 'Tactician Crew', blurb: 'Speed-ish runs and build theory-crafting.', members: 6, leader: 'Okonkwo', viewer: 'not-member' },
  { id: 3, game: GAME_NAME, name: 'Owlbear Appreciation', blurb: 'Casual co-op, one act per week.', members: 3, leader: 'Tamsin', viewer: 'not-member' },
  { id: 4, game: 'Deep Rock Galactic', name: 'Rock and Stone Night', blurb: 'Haz 5 dives every Tuesday.', members: 9, leader: 'Brannoc', viewer: 'leader' },
  { id: 5, game: 'Helldivers 2', name: 'Managed Democracy', blurb: 'Weekend operations, mics optional.', members: 21, leader: 'Vasquez', viewer: 'not-member' },
];

export const MEMBERS: readonly MockMember[] = [
  { name: 'Mirelle', role: 'Leader', joined: '2 Oct' },
  { name: 'Okonkwo', role: 'Officer', joined: '3 Oct' },
  { name: 'Tamsin', role: 'Member', joined: '5 Oct' },
  { name: 'Brannoc', role: 'Member', joined: '11 Oct' },
  { name: 'Vasquez', role: 'Member', joined: '18 Oct' },
];

export const PROPOSALS: readonly MockProposal[] = [
  { id: 11, game: GAME_NAME, name: 'Dark Urge Book Club', blurb: 'Evil playthroughs, one chapter a week, lore chat after.', proposer: 'Tamsin', submitted: '2 h ago' },
  { id: 12, game: 'Stardew Valley', name: 'Pelican Town Co-op', blurb: 'Four-farmer save, Sunday mornings.', proposer: 'Brannoc', submitted: 'yesterday' },
];

export const MY_PROPOSAL: MockProposal = {
  id: 13, game: GAME_NAME, name: 'Late-Night Larian', blurb: 'Act 3 grind after 11 PM.', proposer: 'You', submitted: '20 min ago',
};

export const LEADER_POST = {
  author: 'Mirelle',
  when: 'Today, 9:14 AM',
  body: 'Friday we start a fresh Honour run — meet in the voice channel at 8. Bring a character idea; we pick the party together.',
};

export const EVENTS: readonly { title: string; when: string; going: number }[] = [
  { title: 'Honour run — Act 1', when: 'Fri 24 Oct, 8:00 PM', going: 5 },
  { title: 'Build night', when: 'Tue 28 Oct, 7:30 PM', going: 3 },
];
