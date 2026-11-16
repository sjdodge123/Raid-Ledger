import { HttpException } from '@nestjs/common';
import { PermissionFlagsBits } from 'discord.js';
import {
  missingForumPermissions,
  parseBindBody,
  planSharedTags,
  tagNameFor,
  tagsFree,
} from './hub-forum-discord.helpers';

/** The coded body of a thrown forum error (fails loudly otherwise). */
function codeOf(fn: () => unknown): unknown {
  try {
    fn();
  } catch (err) {
    if (err instanceof HttpException) return err.getResponse();
    throw err;
  }
  throw new Error('expected a throw');
}

const tags = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: `t${String(i)}`,
    name: `mod ${String(i)}`,
  }));

describe('ROK-2208 hub forum Discord helpers', () => {
  it('names every missing sync permission, Manage Channels only when asked', () => {
    const onlyView = (f: bigint) => f === PermissionFlagsBits.ViewChannel;
    expect(missingForumPermissions(onlyView, false)).not.toContain(
      'Manage Channels',
    );
    expect(missingForumPermissions(onlyView, false)).toContain(
      'Manage Webhooks',
    );
    expect(missingForumPermissions(onlyView, true)[0]).toBe('Manage Channels');
    expect(missingForumPermissions(() => true, true)).toEqual([]);
  });

  it('AC4: a forum at 20 tags refuses a 2nd hub with FORUM_DISCORD_TAG_LIMIT', () => {
    const hubs = [{ guildId: 1, tagId: null, hubName: 'Alpha' }];
    expect(codeOf(() => planSharedTags(tags(20), hubs))).toMatchObject({
      statusCode: 409,
      code: 'FORUM_DISCORD_TAG_LIMIT',
    });
    expect(tagsFree(20)).toBe(0);
    expect(tagsFree(18)).toBe(2);
  });

  it('counts both new hub tags against the cap when the 2nd hub joins', () => {
    const hubs = [
      { guildId: 1, tagId: null, hubName: 'Alpha' },
      { guildId: 2, tagId: null, hubName: 'Beta' },
    ];
    expect(codeOf(() => planSharedTags(tags(19), hubs))).toMatchObject({
      code: 'FORUM_DISCORD_TAG_LIMIT',
    });
    expect(planSharedTags(tags(18), hubs).create).toEqual(['Alpha', 'Beta']);
  });

  it('reuses a leftover tag by name and suffixes a name another hub holds', () => {
    const existing = [
      { id: 'a', name: 'Alpha' },
      { id: 'old', name: 'Gamma' },
    ];
    const plan = planSharedTags(existing, [
      { guildId: 1, tagId: 'a', hubName: 'Alpha' },
      { guildId: 2, tagId: null, hubName: 'Alpha' },
      { guildId: 3, tagId: null, hubName: 'Gamma' },
    ]);
    expect(plan.assign).toEqual([
      { guildId: 2, name: 'Alpha 2' },
      { guildId: 3, name: 'Gamma' },
    ]);
    expect(plan.create).toEqual(['Alpha 2']);
  });

  it('truncates tag names to 20 chars', () => {
    expect(tagNameFor('  A very long hub name indeed ')).toHaveLength(20);
  });

  it('AC1: a body without ack: true is FORUM_DISCORD_ACK_REQUIRED', () => {
    for (const body of [
      { mode: 'create' },
      { mode: 'create', ack: false },
      null,
    ]) {
      expect(codeOf(() => parseBindBody(body))).toMatchObject({
        statusCode: 400,
        code: 'FORUM_DISCORD_ACK_REQUIRED',
      });
    }
  });

  it('requires channelId for existing and accepts a clean create', () => {
    expect(
      codeOf(() => parseBindBody({ mode: 'existing', ack: true })),
    ).toMatchObject({
      code: 'FORUM_DISCORD_INVALID',
    });
    expect(parseBindBody({ mode: 'create', ack: true })).toEqual({
      mode: 'create',
      ack: true,
    });
  });
});
