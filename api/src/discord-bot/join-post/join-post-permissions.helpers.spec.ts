import { PermissionFlagsBits, PermissionsBitField } from 'discord.js';
import { JOIN_POST_PERMISSION_NAMES } from '@raid-ledger/contract';
import { missingJoinPostPermissions } from './join-post-permissions.helpers';

const ALL = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.EmbedLinks,
  PermissionFlagsBits.ReadMessageHistory,
  PermissionFlagsBits.ManageMessages,
];

describe('missingJoinPostPermissions', () => {
  it('answers nothing missing when every permission is granted', () => {
    expect(missingJoinPostPermissions(new PermissionsBitField(ALL))).toEqual(
      [],
    );
  });

  it('answers every permission, in display order, when perms are unknown', () => {
    expect(missingJoinPostPermissions(null)).toEqual([
      ...JOIN_POST_PERMISSION_NAMES,
    ]);
  });

  it.each([
    [PermissionFlagsBits.ViewChannel, 'View Channel'],
    [PermissionFlagsBits.SendMessages, 'Send Messages'],
    [PermissionFlagsBits.EmbedLinks, 'Embed Links'],
    [PermissionFlagsBits.ReadMessageHistory, 'Read Message History'],
    [PermissionFlagsBits.ManageMessages, 'Manage Messages'],
  ])('names exactly the one missing flag %s as "%s"', (flag, name) => {
    const perms = new PermissionsBitField(ALL.filter((f) => f !== flag));
    expect(missingJoinPostPermissions(perms)).toEqual([name]);
  });

  it('treats Administrator as granting everything', () => {
    const perms = new PermissionsBitField([PermissionFlagsBits.Administrator]);
    expect(missingJoinPostPermissions(perms)).toEqual([]);
  });
});
