/**
 * Shared type definitions for the GameTime feature.
 * Extracted from game-time.service.ts for file size compliance (ROK-711).
 */

export interface TemplateSlot {
  dayOfWeek: number;
  hour: number;
}

export interface CompositeSlot {
  dayOfWeek: number;
  hour: number;
  status: 'available' | 'committed' | 'blocked' | 'freed';
  fromTemplate?: boolean;
}

export interface EventBlockDescriptor {
  eventId: number;
  title: string;
  gameSlug: string | null;
  gameName: string | null;
  gameId: number | null;
  coverUrl: string | null;
  signupId: number;
  confirmationStatus: 'pending' | 'confirmed' | 'changed';
  dayOfWeek: number;
  startHour: number;
  endHour: number; // exclusive, 24 = end of day
  description: string | null;
  creatorUsername: string | null;
  signupsPreview: Array<{
    id: number;
    username: string;
    avatar: string | null;
    characters?: Array<{ gameId: number; avatarUrl: string | null }>;
  }>;
  signupCount: number;
}

export interface OverrideRecord {
  date: string;
  hour: number;
  status: string;
}

export interface AbsenceRecord {
  id: number;
  startDate: string;
  endDate: string;
  reason: string | null;
}

/** Shape of signed-up event rows returned by the week query. */
export interface SignedUpEventRow {
  eventId: number;
  title: string;
  description: string | null;
  duration: [Date, Date];
  signupId: number;
  confirmationStatus: string;
  gameId: number | null;
  gameSlug: string | null;
  gameName: string | null;
  gameCoverUrl: string | null;
  creatorUsername: string | null;
}

/** Result shape of the composite view. */
export interface CompositeViewResult {
  slots: CompositeSlot[];
  events: EventBlockDescriptor[];
  weekStart: string;
  overrides: OverrideRecord[];
  absences: AbsenceRecord[];
  /** True if game_time_confirmed_at is null or > 7 days old (ROK-999). */
  gameTimeStale?: boolean;
}
