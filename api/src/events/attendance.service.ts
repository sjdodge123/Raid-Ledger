import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import {
  buildSignupResponse,
  buildAnonymousSignupResponse,
} from './signup-response.helpers';
import {
  resolveAttendanceStatus,
  buildAttendanceSignupResponse,
  computeAttendanceSummary,
} from './attendance.helpers';
import type {
  RecordAttendanceDto,
  AttendanceSummaryDto,
  SignupResponseDto,
} from '@raid-ledger/contract';

@Injectable()
export class AttendanceService {
  private readonly logger = new Logger(AttendanceService.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private db: PostgresJsDatabase<typeof schema>,
  ) {}

  async recordAttendance(
    eventId: number,
    dto: RecordAttendanceDto,
    actorId: number,
    isAdmin: boolean,
  ): Promise<SignupResponseDto> {
    const event = await this.findEventOrThrow(eventId);
    if (new Date() < event.duration[1]) {
      throw new BadRequestException(
        'Cannot record attendance for an event that has not ended yet',
      );
    }
    this.assertCreatorOrAdmin(event, actorId, isAdmin, 'record attendance');

    const signup = await this.findSignupOrThrow(eventId, dto.signupId);
    const [updated] = await this.db
      .update(schema.eventSignups)
      .set({
        attendanceStatus: dto.attendanceStatus,
        attendanceRecordedAt: new Date(),
      })
      .where(eq(schema.eventSignups.id, signup.id))
      .returning();

    this.logger.log(
      `Attendance recorded for signup ${dto.signupId} on event ${eventId}: ${dto.attendanceStatus}`,
    );
    return this.buildResponseForUpdated(updated);
  }

  async getAttendanceSummary(
    eventId: number,
    actorId: number,
    isAdmin: boolean,
  ): Promise<AttendanceSummaryDto> {
    const event = await this.findEventOrThrow(eventId);
    this.assertCreatorOrAdmin(event, actorId, isAdmin, 'view attendance');

    const signups = await this.db
      .select()
      .from(schema.eventSignups)
      .leftJoin(schema.users, eq(schema.eventSignups.userId, schema.users.id))
      .leftJoin(
        schema.characters,
        eq(schema.eventSignups.characterId, schema.characters.id),
      )
      .where(eq(schema.eventSignups.eventId, eventId))
      .orderBy(schema.eventSignups.signedUpAt);

    const eventStartTime = event.duration[0];
    const signupResponses: SignupResponseDto[] = signups.map((row) => {
      const resolved = resolveAttendanceStatus(
        row.event_signups,
        eventStartTime,
      );
      return buildAttendanceSignupResponse(row, resolved);
    });

    return computeAttendanceSummary(eventId, signupResponses);
  }

  private async findEventOrThrow(eventId: number) {
    const [event] = await this.db
      .select()
      .from(schema.events)
      .where(eq(schema.events.id, eventId))
      .limit(1);
    if (!event)
      throw new NotFoundException(`Event with ID ${eventId} not found`);
    return event;
  }

  private assertCreatorOrAdmin(
    event: { creatorId: number },
    actorId: number,
    isAdmin: boolean,
    action: string,
  ): void {
    if (event.creatorId !== actorId && !isAdmin) {
      throw new ForbiddenException(
        `Only the event creator or an admin can ${action}`,
      );
    }
  }

  private async findSignupOrThrow(eventId: number, signupId: number) {
    const [signup] = await this.db
      .select()
      .from(schema.eventSignups)
      .where(
        and(
          eq(schema.eventSignups.id, signupId),
          eq(schema.eventSignups.eventId, eventId),
        ),
      )
      .limit(1);
    if (!signup) {
      throw new NotFoundException(
        `Signup ${signupId} not found on event ${eventId}`,
      );
    }
    return signup;
  }

  private async buildResponseForUpdated(
    updated: typeof schema.eventSignups.$inferSelect,
  ): Promise<SignupResponseDto> {
    if (!updated.userId) return buildAnonymousSignupResponse(updated);
    const [user] = await this.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, updated.userId))
      .limit(1);
    const character = updated.characterId
      ? (
          await this.db
            .select()
            .from(schema.characters)
            .where(eq(schema.characters.id, updated.characterId))
            .limit(1)
        )[0]
      : null;
    return buildSignupResponse(updated, user, character);
  }
}
