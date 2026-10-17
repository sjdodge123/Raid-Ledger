/** ROK-1745: the controller wraps the service result in `{ quests }`. */
import { NotFoundException } from '@nestjs/common';
import { CharacterQuestsController } from './character-quests.controller';
import type { CharacterQuestsService } from './character-quests.service';

const ID = '6f0c1d2e-3a4b-4c5d-8e9f-0a1b2c3d4e5f';

function make(getForCharacter: jest.Mock): CharacterQuestsController {
  return new CharacterQuestsController({
    getForCharacter,
  } as unknown as CharacterQuestsService);
}

describe('CharacterQuestsController.getQuests', () => {
  it('wraps a hidden (null) result as { quests: null }', async () => {
    const ctrl = make(jest.fn().mockResolvedValue(null));
    await expect(ctrl.getQuests(ID)).resolves.toEqual({ quests: null });
  });

  it('wraps the DTO under quests', async () => {
    const dto = { source: 'addon' };
    const svc = jest.fn().mockResolvedValue(dto);
    await expect(make(svc).getQuests(ID)).resolves.toEqual({ quests: dto });
    expect(svc).toHaveBeenCalledWith(ID);
  });

  it('propagates the 404 from the service', async () => {
    const ctrl = make(jest.fn().mockRejectedValue(new NotFoundException()));
    await expect(ctrl.getQuests(ID)).rejects.toBeInstanceOf(NotFoundException);
  });
});
