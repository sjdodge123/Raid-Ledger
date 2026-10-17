import {
  buildCopyId,
  decodeCopyId,
  deriveInstanceId,
  parseCopyId,
} from './rl-copy-id.helpers';

/** sha256('raid.gamernight.net') first 12 hex, pinned. */
const OURS = '5f2c106ce10c';
const FOREIGN = 'abcdef012345';

describe('rl-copy-id helpers', () => {
  it('derives the instance id from the lower-cased, trimmed host', () => {
    expect(deriveInstanceId('raid.gamernight.net')).toBe(OURS);
    expect(deriveInstanceId('  RAID.GamerNight.net ')).toBe(OURS);
    expect(() => deriveInstanceId('  ')).toThrow('instance host is empty');
  });

  it('builds rl:<instance>:<eventId>:<userId> and parses it back', () => {
    const id = buildCopyId({ instanceId: OURS, eventId: 42, userId: 7 });
    expect(id).toBe(`rl:${OURS}:42:7`);
    expect(parseCopyId(id, OURS)).toEqual({ eventId: 42, userId: 7 });
  });

  it('parses a foreign instance to null but still decodes it', () => {
    const id = buildCopyId({ instanceId: FOREIGN, eventId: 1, userId: 2 });
    expect(parseCopyId(id, OURS)).toBeNull();
    expect(decodeCopyId(id)).toEqual({
      instanceId: FOREIGN,
      eventId: 1,
      userId: 2,
    });
  });

  it.each([
    `rl:${OURS}:0:7`,
    `rl:${OURS}:01:7`,
    `rl:${OURS}:42:7:9`,
    `rl:${OURS}:42`,
    `rl:${OURS.toUpperCase()}:42:7`,
    `rl:${OURS}a:42:7`,
    ` rl:${OURS}:42:7`,
    `rl:${OURS}:9007199254740993:7`,
    'rl-42-7@raid.gamernight.net',
    '',
  ])('decodes %p to null', (raw) => {
    expect(decodeCopyId(raw)).toBeNull();
    expect(parseCopyId(raw, OURS)).toBeNull();
  });

  it.each([42, null, undefined, {}])(
    'decodes a non-string %p to null',
    (raw) => {
      expect(decodeCopyId(raw)).toBeNull();
    },
  );

  it('refuses to build from a malformed instance id', () => {
    expect(() =>
      buildCopyId({ instanceId: 'xyz', eventId: 1, userId: 1 }),
    ).toThrow('instanceId must be 12 lower-case hex characters');
  });

  it.each([0, -1, 1.5, Number.NaN])('refuses to build with id %p', (bad) => {
    expect(() =>
      buildCopyId({ instanceId: OURS, eventId: bad, userId: 1 }),
    ).toThrow('eventId and userId must be positive integers');
    expect(() =>
      buildCopyId({ instanceId: OURS, eventId: 1, userId: bad }),
    ).toThrow('eventId and userId must be positive integers');
  });
});
