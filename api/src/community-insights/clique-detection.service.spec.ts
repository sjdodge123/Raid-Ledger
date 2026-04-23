import { CliqueDetectionService } from './clique-detection.service';

describe('CliqueDetectionService', () => {
  const service = new CliqueDetectionService();

  it('returns empty for empty node list', () => {
    expect(service.detectCliques([], [])).toEqual([]);
  });

  it('assigns each isolated node its own community when there are no edges', () => {
    const nodes = [{ userId: 1 }, { userId: 2 }, { userId: 3 }];
    const cliques = service.detectCliques(nodes, []);
    expect(cliques).toHaveLength(3);
    expect(cliques.flatMap((c) => c.memberUserIds).sort()).toEqual([1, 2, 3]);
  });

  it('detects two distinct communities with a bridge edge between them', () => {
    const nodes = [
      { userId: 1 },
      { userId: 2 },
      { userId: 3 },
      { userId: 4 },
      { userId: 5 },
      { userId: 10 },
      { userId: 11 },
      { userId: 12 },
      { userId: 13 },
      { userId: 14 },
    ];
    const groupA: Array<[number, number]> = [
      [1, 2],
      [1, 3],
      [1, 4],
      [1, 5],
      [2, 3],
      [2, 4],
      [2, 5],
      [3, 4],
      [3, 5],
      [4, 5],
    ];
    const groupB: Array<[number, number]> = [
      [10, 11],
      [10, 12],
      [10, 13],
      [10, 14],
      [11, 12],
      [11, 13],
      [11, 14],
      [12, 13],
      [12, 14],
      [13, 14],
    ];
    const bridge: Array<[number, number]> = [[5, 10]];
    const edges = [...groupA, ...groupB, ...bridge].map(([a, b]) => ({
      sourceUserId: a,
      targetUserId: b,
      weight: 5,
    }));
    const cliques = service.detectCliques(nodes, edges);
    expect(cliques.length).toBeGreaterThanOrEqual(2);
    expect(cliques[0].memberUserIds.length).toBeGreaterThanOrEqual(
      cliques[1]?.memberUserIds.length ?? 0,
    );
  });

  it('produces deterministic ordering across runs on the same input', () => {
    const nodes = [1, 2, 3, 4].map((id) => ({ userId: id }));
    const edges = [
      { sourceUserId: 1, targetUserId: 2, weight: 10 },
      { sourceUserId: 3, targetUserId: 4, weight: 10 },
    ];
    const first = service.detectCliques(nodes, edges);
    const second = service.detectCliques(nodes, edges);
    expect(first.map((c) => c.memberUserIds)).toEqual(
      second.map((c) => c.memberUserIds),
    );
  });
});
