import {
  warnLinkDisagreements,
  type LinkDisagreement,
} from './guild-link.disagreements';

const ROW: LinkDisagreement = {
  guildId: 7,
  memberId: 11,
  guidCharacterId: 'char-guid',
  blizzardCharacterId: 'char-armory',
};

describe('warnLinkDisagreements (ROK-2115 Ruling 3)', () => {
  it('warns once per disagreeing row with ids only', () => {
    const warn = jest.fn();
    warnLinkDisagreements([ROW, { ...ROW, memberId: 12 }], { warn });
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenNthCalledWith(1, {
      msg: 'roster link disagreement',
      guildId: 7,
      memberId: 11,
      guidCharacterId: 'char-guid',
      blizzardCharacterId: 'char-armory',
    });
  });

  it('stays silent when nothing disagrees', () => {
    const warn = jest.fn();
    warnLinkDisagreements([], { warn });
    expect(warn).not.toHaveBeenCalled();
  });
});
