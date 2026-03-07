/**
 * Parameter object types for SignupsService methods.
 * Bundles related parameters into typed objects to reduce Prettier line
 * expansion and comply with max-lines-per-function (ROK-719).
 */
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import type {
  CreateSignupDto,
  CreateDiscordSignupDto,
} from '@raid-ledger/contract';

export type Tx = PostgresJsDatabase<typeof schema>;
export type EventRow = typeof schema.events.$inferSelect;
export type SignupRow = typeof schema.eventSignups.$inferSelect;
export type UserRow = typeof schema.users.$inferSelect;
export type AssignmentRow = typeof schema.rosterAssignments.$inferSelect;

export interface SignupTxParams {
  tx: Tx;
  eventRow: EventRow;
  eventId: number;
  userId: number;
  dto: CreateSignupDto | undefined;
  user: UserRow | undefined;
}

export interface DirectSlotParams {
  tx: Tx;
  eventRow: EventRow;
  eventId: number;
  signupId: number;
  dto: CreateSignupDto | undefined;
  autoBench: boolean;
  logPrefix: string;
}

export interface NewSignupParams {
  tx: Tx;
  eventRow: EventRow;
  eventId: number;
  userId: number;
  inserted: SignupRow;
  dto: CreateSignupDto | undefined;
  autoBench: boolean;
}

export interface DiscordSlotParams {
  tx: Tx;
  event: EventRow;
  eventId: number;
  signupId: number;
  dto: CreateDiscordSignupDto;
}

export interface PromoteMmoParams {
  tx: Tx;
  eventId: number;
  signupId: number;
  slotConfig: Record<string, unknown>;
  signup: { preferredRoles: string[] | null; userId: number | null };
  username: string;
}

export interface MmoPromotionResultParams {
  tx: Tx;
  eventId: number;
  signupId: number;
  beforeAssignments: RosterSnapshotEntry[];
  newAssignment: { role: string | null; position: number };
  signup: { preferredRoles: string[] | null };
  username: string;
}

export type RosterSnapshotEntry = {
  id: number;
  signupId: number;
  role: string | null;
  position: number;
};

export interface DuplicateSignupParams extends SignupTxParams {
  autoBench: boolean;
  hasCharacter: boolean;
}

export interface DisplaceTentativeParams {
  tx: Tx;
  eventId: number;
  newSignupId: number;
  newPrefs: string[];
  currentAssignments: DisplaceAssignmentEntry[];
  allSignups: DisplaceSignupEntry[];
  roleCapacity: Record<string, number>;
  occupiedPositions: Record<string, Set<number>>;
  findPos: (role: string) => number;
}

export type DisplaceAssignmentEntry = {
  id: number;
  signupId: number;
  role: string | null;
  position: number;
};

export type DisplaceSignupEntry = {
  id: number;
  preferredRoles: string[] | null;
  status: string;
  signedUpAt: Date | null;
};

export interface ExecuteDisplacementParams {
  tx: Tx;
  eventId: number;
  newSignupId: number;
  role: string;
  victim: { id: number; signupId: number; position: number };
  currentAssignments: DisplaceAssignmentEntry[];
  roleCapacity: Record<string, number>;
  occupiedPositions: Record<string, Set<number>>;
  findPos: (role: string) => number;
  signupById: Map<number, { preferredRoles: string[] | null }>;
}

export interface RearrangeVictimParams {
  tx: Tx;
  victim: { id: number; signupId: number; position: number };
  displacedRole: string;
  currentAssignments: Array<{ role: string | null }>;
  roleCapacity: Record<string, number>;
  occupiedPositions: Record<string, Set<number>>;
  findPos: (role: string) => number;
  signupById: Map<number, { preferredRoles: string[] | null }>;
}

export interface DisplacedNotificationParams {
  tx: Tx;
  eventId: number;
  victimSignupId: number;
  role: string;
  rearrangedToRole: string | undefined;
}

export interface OccupantMovesParams {
  occupant: { id: number; signupId: number; position: number };
  entry: BfsEntryType;
  allSignups: BfsSignupType[];
  roleCapacity: Record<string, number>;
  filledPerRole: Record<string, number>;
  queue: BfsEntryType[];
}

export interface ChainMoveEntryType {
  assignmentId: number;
  signupId: number;
  fromRole: string;
  toRole: string;
  position: number;
}

export type BfsEntryType = {
  roleToFree: string;
  moves: ChainMoveEntryType[];
  usedSignupIds: Set<number>;
};

export type BfsSignupType = { id: number; preferredRoles: string[] | null };
