/**
 * TasteProfileController — similar-players `limit` query parsing.
 * A non-numeric `limit` used to become NaN → SQL LIMIT NaN → 500.
 */
import { Test } from '@nestjs/testing';
import type { AuthenticatedRequest } from '../auth/types';
import { TasteProfileController } from './taste-profile.controller';
import { TasteProfileService } from './taste-profile.service';

const findSimilarPlayers = jest.fn();
const isUserDeactivated = jest.fn();

const req: AuthenticatedRequest = {
  user: {
    id: 1,
    username: 'viewer',
    role: 'member',
    discordId: null,
    deactivatedAt: null,
    impersonatedBy: null,
    tokenVersion: 0,
  },
};

async function buildController(): Promise<TasteProfileController> {
  const moduleRef = await Test.createTestingModule({
    controllers: [TasteProfileController],
    providers: [
      {
        provide: TasteProfileService,
        useValue: { findSimilarPlayers, isUserDeactivated },
      },
    ],
  }).compile();
  return moduleRef.get(TasteProfileController);
}

describe('TasteProfileController.getSimilarPlayers limit parsing', () => {
  let controller: TasteProfileController;

  beforeEach(async () => {
    jest.clearAllMocks();
    findSimilarPlayers.mockResolvedValue([]);
    isUserDeactivated.mockResolvedValue(false);
    controller = await buildController();
  });

  it.each([
    ['abc', 10],
    ['0', 1],
    ['99', 50],
    ['7', 7],
    [undefined, 10],
  ])('limit=%s → service called with %i', async (raw, expected) => {
    await controller.getSimilarPlayers(42, req, raw);
    expect(findSimilarPlayers).toHaveBeenCalledWith(42, expected);
  });
});
