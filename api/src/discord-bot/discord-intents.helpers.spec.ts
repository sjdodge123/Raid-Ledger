/**
 * ROK-1703 — privileged-intent detection from `GET /applications/@me` flags.
 * Bit values per https://docs.discord.com/developers/resources/application
 * (Application Flags), confirmed 2026-10-30.
 */
import {
  applicationIdFromToken,
  describeMissingIntents,
  fetchMissingPrivilegedIntents,
  missingIntentsFromFlags,
} from './discord-intents.helpers';

const GATEWAY_PRESENCE = 1 << 12;
const GATEWAY_PRESENCE_LIMITED = 1 << 13;
const GATEWAY_GUILD_MEMBERS = 1 << 14;
const GATEWAY_GUILD_MEMBERS_LIMITED = 1 << 15;
const GATEWAY_MESSAGE_CONTENT = 1 << 18;
const GATEWAY_MESSAGE_CONTENT_LIMITED = 1 << 19;
const APPLICATION_COMMAND_BADGE = 1 << 23;

/**
 * Anonymised `GET /applications/@me` body for an unverified app (< 100
 * servers): Presence and Server Members switched on in the portal (the
 * `_LIMITED` bits), Message Content left off.
 */
const APPLICATION_ME_FIXTURE = {
  id: '900000000000000001',
  name: 'Test Raid Ledger',
  bot_public: false,
  flags:
    GATEWAY_PRESENCE_LIMITED |
    GATEWAY_GUILD_MEMBERS_LIMITED |
    APPLICATION_COMMAND_BADGE,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('missingIntentsFromFlags', () => {
  it('lists all three when no intent bit is set', () => {
    expect(missingIntentsFromFlags(APPLICATION_COMMAND_BADGE)).toEqual([
      'presence',
      'guildMembers',
      'messageContent',
    ]);
  });

  it('treats the _LIMITED bit (unverified apps) as on', () => {
    expect(missingIntentsFromFlags(APPLICATION_ME_FIXTURE.flags)).toEqual([
      'messageContent',
    ]);
  });

  it('treats the plain bit (verified apps) as on', () => {
    const flags =
      GATEWAY_PRESENCE | GATEWAY_GUILD_MEMBERS | GATEWAY_MESSAGE_CONTENT;
    expect(missingIntentsFromFlags(flags)).toEqual([]);
  });

  it('reports only Server Members when it alone is off', () => {
    const flags = GATEWAY_PRESENCE_LIMITED | GATEWAY_MESSAGE_CONTENT_LIMITED;
    expect(missingIntentsFromFlags(flags)).toEqual(['guildMembers']);
  });
});

describe('fetchMissingPrivilegedIntents', () => {
  it('calls applications/@me with Bot auth and reads its flags', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(jsonResponse(APPLICATION_ME_FIXTURE));
    const result = await fetchMissingPrivilegedIntents('tok', fetchImpl);
    expect(result).toEqual(['messageContent']);
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://discord.com/api/v10/applications/@me',
      expect.objectContaining({ headers: { Authorization: 'Bot tok' } }),
    );
  });

  it('returns null (unknown) on a 401', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(jsonResponse({ message: '401: Unauthorized' }, 401));
    expect(await fetchMissingPrivilegedIntents('bad', fetchImpl)).toBeNull();
  });

  it('returns null when the request throws', async () => {
    const fetchImpl = jest.fn().mockRejectedValue(new Error('ENOTFOUND'));
    expect(await fetchMissingPrivilegedIntents('tok', fetchImpl)).toBeNull();
  });

  it('returns null when the body has no numeric flags', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse({ id: '1' }));
    expect(await fetchMissingPrivilegedIntents('tok', fetchImpl)).toBeNull();
  });
});

describe('applicationIdFromToken', () => {
  it('decodes the application id from the first segment', () => {
    const first = Buffer.from('900000000000000001').toString('base64url');
    expect(applicationIdFromToken(`${first}.GxYzAb.fake-signature`)).toBe(
      '900000000000000001',
    );
  });

  it('returns null for a garbage token', () => {
    expect(applicationIdFromToken('not-a-token')).toBeNull();
    expect(applicationIdFromToken('')).toBeNull();
  });

  it('returns null when the segment decodes to a non-snowflake', () => {
    const first = Buffer.from('hello world').toString('base64url');
    expect(applicationIdFromToken(`${first}.a.b`)).toBeNull();
  });
});

describe('describeMissingIntents', () => {
  it('names one intent', () => {
    expect(describeMissingIntents(['messageContent'])).toBe(
      'Message Content Intent',
    );
  });

  it('joins two with "and"', () => {
    expect(describeMissingIntents(['presence', 'messageContent'])).toBe(
      'Presence Intent and Message Content Intent',
    );
  });

  it('falls back to all three without a list', () => {
    expect(describeMissingIntents(null)).toBe(
      'Presence Intent, Server Members Intent and Message Content Intent',
    );
  });
});
