import { describe, expect, it } from 'vitest';
import { emptyAgg, type ChampAgg } from '@/lib/aram/aggregate';
import { computeBuild, mergeAggs, topStats } from '@/lib/aram/build';

function agg(g: number, w: number, extra: Partial<ChampAgg> = {}): ChampAgg {
  return { ...emptyAgg(), g, w, ...extra };
}

describe('topStats', () => {
  it('5판 미만 제외, 판수 내림차순, 비율 계산', () => {
    const out = topStats({ a: [10, 6], b: [4, 4], c: [20, 5] }, 40, 3);
    expect(out).toEqual([
      { key: 'c', games: 20, winRate: 0.25, pickRate: 0.5 },
      { key: 'a', games: 10, winRate: 0.6, pickRate: 0.25 },
    ]);
  });
  it('판수가 같으면 승률 높은 순', () => {
    expect(topStats({ x: [10, 3], y: [10, 7] }, 20, 2).map((s) => s.key)).toEqual(['y', 'x']);
  });
});

describe('mergeAggs', () => {
  it('항목별로 더한다', () => {
    const m = mergeAggs(agg(10, 5, { r: { k: [10, 5] } }), agg(4, 1, { r: { k: [2, 1], j: [2, 0] } }));
    expect(m.g).toBe(14);
    expect(m.w).toBe(6);
    expect(m.r).toEqual({ k: [12, 6], j: [2, 0] });
  });
});

describe('computeBuild', () => {
  const base = { championId: 1, queue: 450 as const, patch: '16.21', prevPatch: '16.20' };

  it('데이터가 없으면 sampleSize 0', () => {
    const b = computeBuild({ ...base, patch: null, prevPatch: null, current: null, prev: null });
    expect(b).toMatchObject({ patch: '', sampleSize: 0, lowSample: true, runes: [], augments: [] });
  });

  it('현재 패치가 30판 미만이면 이전 패치와 합친다', () => {
    const b = computeBuild({ ...base, current: agg(10, 5, { s: { '4-32': [10, 5] } }), prev: agg(50, 25, { s: { '4-32': [50, 25] } }) });
    expect(b.sampleSize).toBe(60);
    expect(b.mergedPatches).toEqual(['16.20']);
    expect(b.lowSample).toBe(false);
    expect(b.spells[0]).toEqual({ key: '4-32', games: 60, winRate: 0.5, pickRate: 1 });
  });

  it('이전 패치가 없으면 합치지 않고 lowSample', () => {
    const b = computeBuild({ ...base, prevPatch: null, current: agg(10, 5), prev: null });
    expect(b).toMatchObject({ sampleSize: 10, lowSample: true, mergedPatches: [] });
  });

  it('30판 이상이면 이전 패치를 쓰지 않는다', () => {
    const b = computeBuild({ ...base, current: agg(30, 15), prev: agg(100, 50) });
    expect(b).toMatchObject({ sampleSize: 30, mergedPatches: [] });
  });

  it('증강은 Mayhem(2400)에서만', () => {
    const a = { '7': [40, 20] as [number, number] };
    expect(computeBuild({ ...base, current: agg(40, 20, { a }), prev: null }).augments).toEqual([]);
    expect(computeBuild({ ...base, queue: 2400, current: agg(40, 20, { a }), prev: null }).augments).toHaveLength(1);
  });
});
