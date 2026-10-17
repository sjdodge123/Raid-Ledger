/**
 * Type definitions for generated demo data.
 */

export interface GeneratedUser {
  username: string;
  avatar: string;
}

export interface GeneratedEvent {
  title: string;
  description: string;
  gameId: number | null;
  igdbId: string;
  startTime: Date;
  endTime: Date;
  maxPlayers: number | null;
}

export interface GeneratedCharacter {
  username: string;
  gameSlug: string;
  charName: string;
  class: string;
  spec: string | null;
  role: 'tank' | 'healer' | 'dps';
  wowClass: string | null;
  isMain: boolean;
}

export interface GeneratedSignup {
  eventIdx: number;
  username: string;
  confirmationStatus: 'confirmed' | 'pending';
}

export interface GeneratedGameTime {
  username: string;
  dayOfWeek: number;
  startHour: number;
}

export interface GeneratedAvailability {
  username: string;
  start: Date;
  end: Date;
  status: 'available' | 'blocked';
}

export interface GeneratedNotification {
  username: string;
  type: string;
  title: string;
  message: string;
  payload: Record<string, unknown>;
  createdAt: Date;
  readAt: Date | null;
}

export interface GeneratedNotifPreference {
  username: string;
  channelPrefs: Record<string, Record<string, boolean>>;
}

export interface GeneratedGameInterest {
  username: string;
  igdbId: number;
}
