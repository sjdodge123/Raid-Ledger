import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { eq, and, ne } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import type {
  RecordAttendanceDto,
  AttendanceSummaryDto,
  AttendanceStatus,
  SignupResponseDto,
  ConfirmationStatus,
  SignupStatus,
} from '@raid-ledger/contract';

@Injectable()
export class AttendanceService {
  private readonly logger = new Logger(AttendanceService.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private db: PostgresJsDatabase<typeof schema>,
  ) {}

  /**
   * Record attendance for a signup on a past event (ROK-421).
   * Only the event creator or an admin can record attendance.
   */
  async recordAttendance(
    eventId: number,
    dto: RecordAttendanceDto,
    actorId: number,
    isAdmin: boolean,
  ): Promise<SignupResponseDto> {
    // Verify event exists and has ended
    const [event] = await this.db
      .select()
      .from(schema.events)
      .where(eq(schema.events.id, eventId))
      .limit(1);

    if (!event) {
      throw new NotFoundException(`Event with ID ${eventId} not found`);
    }

    const endTime = event.duration[1];
    if (new Date() < endTime) {
      throw new BadRequestException(
        'Cannot record attendance for an event that has not ended yet',
      );
    }

    // Verify caller is creator or admin
    if (event.creatorId !== actorId && !isAdmin) {
      throw new ForbiddenException(
        'Only the event creator or an admin can record attendance',
      );
    }

    // Verify signup exists and belongs to this event
    const [signup] = await this.db
      .select()
      .from(schema.eventSignups)
      .where(
        and(
          eq(schema.eventSignups.id, dto.signupId),
          eq(schema.eventSignups.eventId, eventId),
        ),
      )
      .limit(1);

    if (!signup) {
      throw new NotFoundException(
        `Signup ${dto.signupId} not found on event ${eventId}`,
      );
    }

    // Update attendance status
    const [updated] = await this.db
      .update(schema.eventSignups)
      .set({
        attendanceStatus: dto.attendanceStatus,
        attendanceRecordedAt: new Date(),
      })
      .where(eq(schema.eventSignups.id, dto.signupId))
      .returning();

    // Fetch user data for the response
    const user = updated.userId
      ? (
          await this.db
            .select()
            .from(schema.users)
            .where(eq(schema.users.id, updated.userId))
            .limit(1)
        )[0]
      : undefined;

    const character = updated.characterId
      ? (
          await this.db
            .select()
            .from(schema.characters)
            .where(eq(schema.characters.id, updated.characterId))
            .limit(1)
        )[0]
      : null;

    this.logger.log(
      `Attendance recorded for signup ${dto.signupId} on event ${eventId}: ${dto.attendanceStatus}`,
    );

    return this.buildSignupResponse(updated, user, character);
  }

  /**
   * Get attendance summary for a past event (ROK-421).
   */
  async getAttendanceSummary(eventId: number): Promise<AttendanceSummaryDto> {
    // Verify event exists
    const [event] = await this.db
      .select()
      .from(schema.events)
      .where(eq(schema.events.id, eventId))
      .limit(1);

    if (!event) {
      throw new NotFoundException(`Event with ID ${eventId} not found`);
    }

    // Get all non-roached signups with user and character data
    const signups = await this.db
      .select()
      .from(schema.eventSignups)
      .leftJoin(schema.users, eq(schema.eventSignups.userId, schema.users.id))
      .leftJoin(
        schema.characters,
        eq(schema.eventSignups.characterId, schema.characters.id),
      )
      .where(
        and(
          eq(schema.eventSignups.eventId, eventId),
          ne(schema.eventSignups.status, 'roached_out'),
        ),
      )
      .orderBy(schema.eventSignups.signedUpAt);

    const signupResponses: SignupResponseDto[] = signups.map((row) => {
      const isAnonymous = !row.event_signups.userId;
      if (isAnonymous) {
        return {
          id: row.event_signups.id,
          eventId: row.event_signups.eventId,
          user: {
            id: 0,
            discordId: row.event_signups.discordUserId ?? '',
            username: row.event_signups.discordUsername ?? 'Discord User',
            avatar: null,
          },
          note: row.event_signups.note,
          signedUpAt: row.event_signups.signedUpAt.toISOString(),
          characterId: null,
          character: null,
          confirmationStatus: row.event_signups
            .confirmationStatus as ConfirmationStatus,
          status: (row.event_signups.status as SignupStatus) ?? 'signed_up',
          isAnonymous: true,
          discordUserId: row.event_signups.discordUserId,
          discordUsername: row.event_signups.discordUsername,
          discordAvatarHash: row.event_signups.discordAvatarHash,
          preferredRoles:
            (row.event_signups.preferredRoles as
              | ('tank' | 'healer' | 'dps')[]
              | null) ?? null,
          attendanceStatus:
            (row.event_signups.attendanceStatus as AttendanceStatus) ?? null,
          attendanceRecordedAt:
            row.event_signups.attendanceRecordedAt?.toISOString() ?? null,
        };
      }
      return {
        id: row.event_signups.id,
        eventId: row.event_signups.eventId,
        user: {
          id: row.users?.id ?? 0,
          discordId: row.users?.discordId ?? '',
          username: row.users?.username ?? 'Unknown',
          avatar: row.users?.avatar ?? null,
        },
        note: row.event_signups.note,
        signedUpAt: row.event_signups.signedUpAt.toISOString(),
        characterId: row.event_signups.characterId,
        character: row.characters
          ? this.buildCharacterDto(row.characters)
          : null,
        confirmationStatus: row.event_signups
          .confirmationStatus as ConfirmationStatus,
        status: (row.event_signups.status as SignupStatus) ?? 'signed_up',
        preferredRoles:
          (row.event_signups.preferredRoles as
            | ('tank' | 'healer' | 'dps')[]
            | null) ?? null,
        attendanceStatus:
          (row.event_signups.attendanceStatus as AttendanceStatus) ?? null,
        attendanceRecordedAt:
          row.event_signups.attendanceRecordedAt?.toISOString() ?? null,
      };
    });

    const total = signupResponses.length;
    const attended = signupResponses.filter(
      (s) => s.attendanceStatus === 'attended',
    ).length;
    const noShow = signupResponses.filter(
      (s) => s.attendanceStatus === 'no_show',
    ).length;
    const excused = signupResponses.filter(
      (s) => s.attendanceStatus === 'excused',
    ).length;
    const unmarked = total - attended - noShow - excused;

    const markedTotal = attended + noShow + excused;
    const attendanceRate = markedTotal > 0 ? attended / markedTotal : 0;
    const noShowRate = markedTotal > 0 ? noShow / markedTotal : 0;

    return {
      eventId,
      totalSignups: total,
      attended,
      noShow,
      excused,
      unmarked,
      attendanceRate: Math.round(attendanceRate * 100) / 100,
      noShowRate: Math.round(noShowRate * 100) / 100,
      signups: signupResponses,
    };
  }

  private buildSignupResponse(
    signup: typeof schema.eventSignups.$inferSelect,
    user: typeof schema.users.$inferSelect | undefined,
    character: typeof schema.characters.$inferSelect | null | undefined,
  ): SignupResponseDto {
    const isAnonymous = !signup.userId;
    if (isAnonymous) {
      return {
        id: signup.id,
        eventId: signup.eventId,
        user: {
          id: 0,
          discordId: signup.discordUserId ?? '',
          username: signup.discordUsername ?? 'Discord User',
          avatar: null,
        },
        note: signup.note,
        signedUpAt: signup.signedUpAt.toISOString(),
        characterId: null,
        character: null,
        confirmationStatus: signup.confirmationStatus as ConfirmationStatus,
        status: (signup.status as SignupStatus) ?? 'signed_up',
        isAnonymous: true,
        discordUserId: signup.discordUserId,
        discordUsername: signup.discordUsername,
        discordAvatarHash: signup.discordAvatarHash,
        preferredRoles:
          (signup.preferredRoles as ('tank' | 'healer' | 'dps')[] | null) ??
          null,
        attendanceStatus: (signup.attendanceStatus as AttendanceStatus) ?? null,
        attendanceRecordedAt:
          signup.attendanceRecordedAt?.toISOString() ?? null,
      };
    }
    return {
      id: signup.id,
      eventId: signup.eventId,
      user: {
        id: user?.id ?? 0,
        discordId: user?.discordId ?? '',
        username: user?.username ?? 'Unknown',
        avatar: user?.avatar ?? null,
      },
      note: signup.note,
      signedUpAt: signup.signedUpAt.toISOString(),
      characterId: signup.characterId,
      character: character ? this.buildCharacterDto(character) : null,
      confirmationStatus: signup.confirmationStatus as ConfirmationStatus,
      status: (signup.status as SignupStatus) ?? 'signed_up',
      preferredRoles:
        (signup.preferredRoles as ('tank' | 'healer' | 'dps')[] | null) ?? null,
      attendanceStatus: (signup.attendanceStatus as AttendanceStatus) ?? null,
      attendanceRecordedAt: signup.attendanceRecordedAt?.toISOString() ?? null,
    };
  }

  private buildCharacterDto(character: typeof schema.characters.$inferSelect) {
    const roleOverride = character.roleOverride as
      | 'tank'
      | 'healer'
      | 'dps'
      | null;
    const role = character.role as 'tank' | 'healer' | 'dps' | null;
    return {
      id: character.id,
      name: character.name,
      class: character.class,
      spec: character.spec,
      role: roleOverride ?? role,
      isMain: character.isMain,
      itemLevel: character.itemLevel,
      level: character.level,
      avatarUrl: character.avatarUrl,
      race: character.race,
      faction: character.faction as 'alliance' | 'horde' | null,
    };
  }
}
