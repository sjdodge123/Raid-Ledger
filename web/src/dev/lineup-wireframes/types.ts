/**
 * Shared types + enums for ROK-1193 lineup wireframes.
 * DEV-ONLY — gated behind DEMO_MODE in app-routes.tsx.
 */

export type Persona =
  | 'invitee-not-acted'
  | 'invitee-acted'
  | 'organizer'
  | 'admin'
  | 'uninvited';

export type PhaseState =
  | 'plenty-of-time'
  | 'deadline-soon'
  | 'deadline-missed'
  | 'phase-complete'
  | 'aborted';

export type PageId =
  | 'index'
  | 'lineup-detail'
  | 'building'
  | 'voting'
  | 'decided'
  | 'tiebreaker'
  | 'standalone-poll'
  | 'aborted-state';

export const PERSONAS: ReadonlyArray<Persona> = [
  'invitee-not-acted',
  'invitee-acted',
  'organizer',
  'admin',
  'uninvited',
];

export const PHASE_STATES: ReadonlyArray<PhaseState> = [
  'plenty-of-time',
  'deadline-soon',
  'deadline-missed',
  'phase-complete',
  'aborted',
];

export const PAGE_IDS: ReadonlyArray<PageId> = [
  'index',
  'lineup-detail',
  'building',
  'voting',
  'decided',
  'tiebreaker',
  'standalone-poll',
  'aborted-state',
];

export const PERSONA_LABELS: Record<Persona, string> = {
  'invitee-not-acted': 'Invitee — not acted',
  'invitee-acted': 'Invitee — already acted',
  organizer: 'Organizer',
  admin: 'Admin',
  uninvited: 'Uninvited member',
};

export const PHASE_STATE_LABELS: Record<PhaseState, string> = {
  'plenty-of-time': 'Plenty of time',
  'deadline-soon': 'Deadline <24h',
  'deadline-missed': 'Deadline missed',
  'phase-complete': 'Phase complete',
  aborted: 'Lineup aborted',
};

export const PAGE_LABELS: Record<PageId, string> = {
  index: 'Lineups index (proposed)',
  'lineup-detail': 'Lineup detail shell',
  building: 'Building (nominate)',
  voting: 'Voting',
  decided: 'Decided',
  tiebreaker: 'Tiebreaker',
  'standalone-poll': 'Standalone scheduling poll',
  'aborted-state': 'Aborted state',
};

export interface WireframeContext {
  persona: Persona;
  phaseState: PhaseState;
}

export function isPersona(value: string | undefined): value is Persona {
  return !!value && (PERSONAS as ReadonlyArray<string>).includes(value);
}

export function isPhaseState(value: string | undefined): value is PhaseState {
  return !!value && (PHASE_STATES as ReadonlyArray<string>).includes(value);
}

export function isPageId(value: string | undefined): value is PageId {
  return !!value && (PAGE_IDS as ReadonlyArray<string>).includes(value);
}
