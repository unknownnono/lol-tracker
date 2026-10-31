import { describe, expect, it } from 'vitest';
import { aggKey, emptyAgg } from '@/lib/aram/aggregate';
import { championTier, computeChampionTiers, getChampionTiers } from '@/lib/aram/champions';
import { registerPatches, saveAggs } from '@/lib/aram/store';
import { FakeRedis } from '@/test/fakeRedis';

describe('챔피언 티어', () => {
  it('평균 대비 %p 기준', () => {
    expect(championTier(3.2)).toBe('S');
    expect(championTier(1)).toBe('A');
    expect(championTier(0)).toBe('B');
    expect(championTier(-2)).toBe('C');
    expect(championTier(-4)).toBe('D');
  });

  it('보정 승률순, 픽률은 경기 수 대비, 판수 적은 챔피언은 평균 쪽으로', () => {
    const t = computeChampionTiers(
      new Map([
        [1, { g: 400, w: 240 }], // 60%
        [2, { g: 400, w: 200 }], // 50%
        [3, { g: 2, w: 2 }], // 100%지만 2판
        [4, { g: 0, w: 0 }],
      ]),
    );
    expect(t.map((c) => c.championId)).toEqual([1, 3, 2]);
    expect(t[0]).toMatchObject({ winRate: 0.6, tier: 'S', pickRate: round(400 / 80.2) });
    expect(t.find((c) => c.championId === 3)!.tier).not.toBe('S'); // 2판 100%여도 최고 등급은 아님
  });

  it('빈 데이터', () => expect(computeChampionTiers(new Map())).toEqual([]));
});
const round = (x: number) => Math.round(x * 10000) / 10000;

describe('getChampionTiers', () => {
  it('최신·직전 패치를 합쳐서', async () => {
    const r = new FakeRedis();
    await registerPatches(r, ['16.20', '16.21']);
    await saveAggs(r, new Map([
      [aggKey(2400, '16.21', 1), { ...emptyAgg(), g: 10, w: 6 }],
      [aggKey(2400, '16.20', 1), { ...emptyAgg(), g: 10, w: 4 }],
      [aggKey(2400, '16.21', 2), { ...emptyAgg(), g: 20, w: 10 }],
    ]));
    const t = await getChampionTiers([1, 2, 3], 2400, r);
    expect(t.patches).toEqual(['16.21', '16.20']);
    expect(t.games).toBe(4);
    expect(t.champions.map((c) => [c.championId, c.games])).toEqual([[1, 20], [2, 20]]);
  });
  it('패치가 없으면 빈 응답', async () => {
    expect(await getChampionTiers([1], 2400, new FakeRedis())).toEqual({ queue: 2400, patches: [], games: 0, champions: [] });
  });
});
