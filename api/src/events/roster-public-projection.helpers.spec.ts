import {
  PublicSignupResponseSchema,
  PublicSignupUserSchema,
  PublicRosterAssignmentResponseSchema,
  PublicEventCreatorSchema,
} from '@raid-ledger/contract';
import type {
  SignupResponseDto,
  RosterAssignmentResponse,
  RosterWithAssignments,
  EventRosterDto,
  EventResponseDto,
  EventDetailResponseDto,
} from '@raid-ledger/contract';
import {
  isMemberViewer,
  toPublicSignupUser,
  toPublicSignup,
  toPublicRoster,
  toPublicRosterAssignment,
  toPublicRosterWithAssignments,
  toPublicCreator,
  projectEventForViewer,
  projectRosterForViewer,
  projectRosterWithAssignmentsForViewer,
  projectEventDetailForViewer,
} from './roster-public-projection.helpers';

const MEMBER_SNOWFLAKE = '111111111111111111';
const ANON_SNOWFLAKE = '222222222222222222';
const CREATOR_SNOWFLAKE = '333333333333333333';
const CDN = 'https://cdn.discordapp.com/avatars';
const CHAR_ID = '3f1c2b9e-8a7d-4c6b-9e2f-1a2b3c4d5e6f';
const ISO = '2026-10-04T18:00:00.000Z';

/** Keys that must never reach an anonymous viewer, anywhere in the payload. */
const IDENTITY_KEYS = ['discordId', 'discordUserId', 'discordAvatarHash'];
/** Operator ruling Q2: non-identity fields also stripped for anonymous viewers. */
const Q2_SIGNUP_KEYS = [
  'note',
  'attendanceStatus',
  'attendanceRecordedAt',
  'runningLate',
  'runningLateAt',
  'lateMinutes',
];
const Q2_ASSIGNMENT_KEYS = ['runningLate', 'lateMinutes'];

/** Recursive key walk: every path at which a forbidden key appears. */
function forbiddenKeyPaths(value: unknown, path = '$'): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((v, i) => forbiddenKeyPaths(v, `${path}[${i}]`));
  }
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([k, v]) => [
    ...(IDENTITY_KEYS.includes(k) ? [`${path}.${k}`] : []),
    ...forbiddenKeyPaths(v, `${path}.${k}`),
  ]);
}

function memberSignup(): SignupResponseDto {
  return {
    id: 1,
    eventId: 9,
    user: {
      id: 5,
      discordId: MEMBER_SNOWFLAKE,
      username: 'Thrall',
      avatar: 'memberhash',
      customAvatarUrl: null,
      characters: [{ gameId: 1, avatarUrl: 'https://img/c.png' }],
    },
    note: 'secret note',
    signedUpAt: ISO,
    characterId: CHAR_ID,
    character: {
      id: CHAR_ID,
      name: 'Thrallchar',
      class: 'Shaman',
      spec: 'Enhancement',
      role: 'dps',
      isMain: true,
      itemLevel: 500,
      avatarUrl: null,
    },
    confirmationStatus: 'confirmed',
    status: 'signed_up',
    preferredRoles: ['dps', 'healer'],
    attendanceStatus: 'no_show',
    attendanceRecordedAt: ISO,
    assignedSlot: 'dps',
    runningLate: true,
    runningLateAt: ISO,
    lateMinutes: 10,
  };
}

function anonDiscordSignup(): SignupResponseDto {
  return {
    ...memberSignup(),
    id: 2,
    user: {
      id: 0,
      discordId: ANON_SNOWFLAKE,
      username: 'DiscordGuest',
      avatar: null,
    },
    characterId: null,
    character: null,
    isAnonymous: true,
    discordUserId: ANON_SNOWFLAKE,
    discordUsername: 'DiscordGuest',
    discordAvatarHash: 'anonhash',
  };
}

function assignment(
  over: Partial<RosterAssignmentResponse> = {},
): RosterAssignmentResponse {
  return {
    id: 7,
    signupId: 1,
    userId: 5,
    discordId: MEMBER_SNOWFLAKE,
    username: 'Thrall',
    avatar: 'memberhash',
    customAvatarUrl: null,
    slot: 'tank',
    position: 1,
    isOverride: false,
    character: {
      id: CHAR_ID,
      name: 'Thrallchar',
      className: 'Shaman',
      role: 'tank',
      avatarUrl: null,
    },
    preferredRoles: ['tank'],
    signupStatus: 'signed_up',
    runningLate: true,
    lateMinutes: 5,
    ...over,
  };
}

function roster(): EventRosterDto {
  return {
    eventId: 9,
    signups: [memberSignup(), anonDiscordSignup()],
    count: 2,
  };
}

function rosterWithAssignments(): RosterWithAssignments {
  return {
    eventId: 9,
    pool: [assignment({ id: 8, discordId: 'unlinked:bob', avatar: 'h' })],
    assignments: [assignment()],
    slots: { tank: 2, dps: 3 },
  };
}

function event(): EventResponseDto {
  return {
    id: 9,
    title: 'Raid night',
    description: null,
    startTime: ISO,
    endTime: ISO,
    creator: {
      id: 3,
      username: 'Jaina',
      avatar: 'creatorhash',
      discordId: CREATOR_SNOWFLAKE,
    },
    game: null,
    signupCount: 2,
    signupsPreview: [memberSignup().user],
  } as EventResponseDto;
}

describe('isMemberViewer (Q6)', () => {
  it('treats only a signed-in, non-deactivated user as a member', () => {
    expect(isMemberViewer(undefined)).toBe(false);
    expect(isMemberViewer(null)).toBe(false);
    expect(isMemberViewer({ deactivatedAt: new Date() })).toBe(false);
    expect(isMemberViewer({ deactivatedAt: null })).toBe(true);
    expect(isMemberViewer({})).toBe(true);
  });
});

describe('toPublicSignup — anonymous viewer', () => {
  it.each([...IDENTITY_KEYS, ...Q2_SIGNUP_KEYS])(
    'drops %s from the signup row',
    (key) => {
      const out = toPublicSignup(anonDiscordSignup());
      expect(Object.keys(out)).not.toContain(key);
      expect(Object.keys(out.user)).not.toContain(key);
    },
  );

  it('keeps roster structure: status, slot, roles, character (Q2)', () => {
    const out = toPublicSignup(memberSignup());
    expect(out).toMatchObject({
      id: 1,
      eventId: 9,
      status: 'signed_up',
      confirmationStatus: 'confirmed',
      assignedSlot: 'dps',
      preferredRoles: ['dps', 'healer'],
      characterId: CHAR_ID,
      character: { name: 'Thrallchar', class: 'Shaman', role: 'dps' },
      user: { id: 5, username: 'Thrall' },
    });
  });

  it('builds the CDN avatar URL for a linked member', () => {
    expect(toPublicSignup(memberSignup()).user.avatar).toBe(
      `${CDN}/${MEMBER_SNOWFLAKE}/memberhash.png`,
    );
  });

  it('builds the avatar for an anonymous Discord signup from the row hash', () => {
    const out = toPublicSignup(anonDiscordSignup());
    expect(out.user).toEqual({
      id: 0,
      username: 'DiscordGuest',
      avatar: `${CDN}/${ANON_SNOWFLAKE}/anonhash.png`,
    });
    expect(out.isAnonymous).toBe(true);
    expect(out.discordUsername).toBe('DiscordGuest');
  });

  it('drops runtime keys the contract does not know about', () => {
    const leaky = { ...memberSignup(), email: 'x@y.z' } as SignupResponseDto;
    expect(Object.keys(toPublicSignup(leaky))).not.toContain('email');
  });
});

describe('toPublicSignupUser / toPublicCreator', () => {
  it('drops discordId and builds the avatar URL', () => {
    const out = toPublicSignupUser(memberSignup().user);
    expect(Object.keys(out)).not.toContain('discordId');
    expect(out.avatar).toBe(`${CDN}/${MEMBER_SNOWFLAKE}/memberhash.png`);
    expect(out.characters).toEqual([
      { gameId: 1, avatarUrl: 'https://img/c.png' },
    ]);
  });

  it('nulls the avatar for local:/unlinked: users instead of a broken URL', () => {
    const local = { ...memberSignup().user, discordId: 'local:bob' };
    expect(toPublicSignupUser(local).avatar).toBeNull();
  });

  it('projects the event creator without discordId', () => {
    const out = toPublicCreator(event().creator);
    expect(Object.keys(out)).not.toContain('discordId');
    expect(out).toMatchObject({ id: 3, username: 'Jaina' });
    expect(out.avatar).toBe(`${CDN}/${CREATOR_SNOWFLAKE}/creatorhash.png`);
  });
});

describe('toPublicRosterAssignment — anonymous viewer', () => {
  it.each([...IDENTITY_KEYS, ...Q2_ASSIGNMENT_KEYS])('drops %s', (key) => {
    expect(Object.keys(toPublicRosterAssignment(assignment()))).not.toContain(
      key,
    );
  });

  it('keeps slot, position, character and status', () => {
    expect(toPublicRosterAssignment(assignment())).toMatchObject({
      userId: 5,
      username: 'Thrall',
      slot: 'tank',
      position: 1,
      signupStatus: 'signed_up',
      character: { className: 'Shaman', role: 'tank' },
      avatar: `${CDN}/${MEMBER_SNOWFLAKE}/memberhash.png`,
    });
  });

  it('nulls the avatar for an unlinked member', () => {
    const out = toPublicRosterAssignment(
      assignment({ discordId: 'unlinked:bob', avatar: 'h' }),
    );
    expect(out.avatar).toBeNull();
  });
});

describe('route projections — anonymous viewer has no Discord id key anywhere', () => {
  it('GET /events/:id/roster', () => {
    const out = projectRosterForViewer(roster(), false);
    expect(forbiddenKeyPaths(out)).toEqual([]);
    expect(out.signups).toHaveLength(2);
  });

  it('GET /events/:id/roster/assignments', () => {
    const out = projectRosterWithAssignmentsForViewer(
      rosterWithAssignments(),
      false,
    );
    expect(forbiddenKeyPaths(out)).toEqual([]);
    expect(out.slots).toEqual({ tank: 2, dps: 3 });
  });

  it('GET /events and GET /events/:id (creator + signups preview)', () => {
    const out = projectEventForViewer(event(), false);
    expect(forbiddenKeyPaths(out)).toEqual([]);
    expect(out.title).toBe('Raid night');
    expect(out.signupsPreview?.[0]?.username).toBe('Thrall');
  });

  it('GET /events/:id leaves signupsPreview absent when the source had none', () => {
    const noPreview = event();
    delete noPreview.signupsPreview;
    const out = projectEventForViewer(noPreview, false);
    expect(Object.keys(out)).not.toContain('signupsPreview');
  });

  it('GET /events/:id/detail bundle', () => {
    const detail = {
      event: event(),
      roster: roster(),
      rosterAssignments: rosterWithAssignments(),
      pugs: [],
      voiceChannel: { channelId: null, channelName: null, guildId: null },
    } as EventDetailResponseDto;
    const out = projectEventDetailForViewer(detail, false);
    expect(forbiddenKeyPaths(out)).toEqual([]);
    expect(out.voiceChannel).toBe(detail.voiceChannel);
  });
});

describe('route projections — member viewer keeps the full payload', () => {
  it('returns the member payload untouched (same reference, ids present)', () => {
    const r = roster();
    const ra = rosterWithAssignments();
    const e = event();
    const d = {
      event: e,
      roster: r,
      rosterAssignments: ra,
    } as EventDetailResponseDto;
    expect(projectRosterForViewer(r, true)).toBe(r);
    expect(projectRosterWithAssignmentsForViewer(ra, true)).toBe(ra);
    expect(projectEventForViewer(e, true)).toBe(e);
    expect(projectEventDetailForViewer(d, true)).toBe(d);
    expect(forbiddenKeyPaths(r)).toContain('$.signups[0].user.discordId');
    expect(r.signups[0]).toHaveProperty('note', 'secret note');
  });
});

describe('Public* schemas are strict', () => {
  it('reject a Discord id key instead of stripping it silently', () => {
    const pub = toPublicSignup(memberSignup());
    expect(() =>
      PublicSignupResponseSchema.parse({ ...pub, discordUserId: 'x' }),
    ).toThrow(/discordUserId/);
    expect(() =>
      PublicSignupUserSchema.parse({ ...pub.user, discordId: 'x' }),
    ).toThrow(/discordId/);
    expect(() =>
      PublicRosterAssignmentResponseSchema.parse({
        ...toPublicRosterAssignment(assignment()),
        discordId: 'x',
      }),
    ).toThrow(/discordId/);
    expect(() =>
      PublicEventCreatorSchema.parse({
        ...toPublicCreator(event().creator),
        discordId: 'x',
      }),
    ).toThrow(/discordId/);
  });

  // Lead directive: keys are strict, VALUES are not — legitimate DB data the
  // member enums/uuid regex do not know must not turn a public route into a 500.
  it('accept DB values the member schema would reject (non-RFC uuid, unknown varchar)', () => {
    const odd = '11111111-1111-1111-1111-111111111111'; // zod v4 .uuid() rejects
    const base = memberSignup();
    const signup = {
      ...base,
      characterId: odd,
      character: base.character && { ...base.character, id: odd },
      status: 'legacy_status',
      confirmationStatus: 'legacy',
      preferredRoles: ['flex'],
      signedUpAt: '2026-10-04 18:00:00+00',
    } as unknown as SignupResponseDto;
    expect(toPublicSignup(signup).characterId).toBe(odd);
    const a = { ...assignment(), slot: 'raider', signupStatus: 'legacy' };
    const pubA = toPublicRosterAssignment(
      a as unknown as RosterAssignmentResponse,
    );
    expect(pubA.slot).toBe('raider');
  });

  it('toPublicRoster / toPublicRosterWithAssignments produce schema-valid output', () => {
    expect(toPublicRoster(roster()).count).toBe(2);
    expect(
      toPublicRosterWithAssignments(rosterWithAssignments()).pool,
    ).toHaveLength(1);
  });
});
