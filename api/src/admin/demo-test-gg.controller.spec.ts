/**
 * DemoTestGgController — POST /admin/test/gg/seed user precheck.
 *
 * An unknown userId must be a 404 before any compute or upsert runs, not a
 * 500 from the gg_snapshots → users foreign key.
 */
import { NotFoundException } from '@nestjs/common';
import { DemoTestGgController } from './demo-test-gg.controller';
import { createDrizzleMock, type MockDb } from '../common/testing/drizzle-mock';

type Ctor = ConstructorParameters<typeof DemoTestGgController>;

const YEAR = 2025;
const SNAPSHOT = { version: 1, year: YEAR };

function setup(): {
  controller: DemoTestGgController;
  db: MockDb;
  compute: { computeForUser: jest.Mock; upsertSnapshot: jest.Mock };
} {
  const db = createDrizzleMock();
  const compute = {
    computeForUser: jest.fn().mockResolvedValue(SNAPSHOT),
    upsertSnapshot: jest.fn().mockResolvedValue(undefined),
  };
  const controller = new DemoTestGgController(
    db as unknown as Ctor[0],
    {} as Ctor[1],
    compute as unknown as Ctor[2],
    {} as Ctor[3],
  );
  return { controller, db, compute };
}

describe('DemoTestGgController — POST /admin/test/gg/seed', () => {
  it('throws NotFoundException for an unknown userId and never computes or upserts', async () => {
    const { controller, db, compute } = setup();
    db.limit.mockResolvedValueOnce([]);

    await expect(
      controller.seed({ userId: 999_999, year: YEAR }),
    ).rejects.toThrow(new NotFoundException('User 999999 not found'));
    expect(compute.computeForUser).not.toHaveBeenCalled();
    expect(compute.upsertSnapshot).not.toHaveBeenCalled();
  });

  it('computes and upserts the snapshot for a known userId', async () => {
    const { controller, db, compute } = setup();
    db.limit.mockResolvedValueOnce([{ id: 7 }]);

    await expect(controller.seed({ userId: 7, year: YEAR })).resolves.toEqual({
      userId: 7,
      year: YEAR,
    });
    expect(compute.computeForUser).toHaveBeenCalledWith(7, YEAR);
    expect(compute.upsertSnapshot).toHaveBeenCalledWith(7, SNAPSHOT);
  });
});
