import { describe, expect, it } from 'vitest';
import type { Sample } from '@/lib/aram/aggregate';
import { applyComboSamples, comboKey, computeCombos, emptyCombo, getCombos, pruneCombo, saveCombos, type ComboAgg } from '@/lib/aram/combos';
import { registerPatches } from '@/lib/aram/store';
import { FakeRedis } from '@/test/fakeRedis';

const sample = (augments: number[], win: boolean, queue: 450 | 2400 = 2400): Sample => ({
  queue, patch: '16.21', championId: 1, win, rune: null, spell: '4-32', items: [], boots: null, augments,
});

describe('증강 조합 집계', () => {
  it('아수라장만, 증강 하나·두 개씩 (순서 무관)', () => {
    const aggs = new Map<string, ComboAgg>();
    applyComboSamples(aggs, [sample([3, 1, 2], true), sample([1, 3], false), sample([1, 3], true, 450)]);
    const a = aggs.get(comboKey(2400, '16.21'))!;
    expect(a.s).toEqual({ 1: [2, 1], 2: [1, 1], 3: [2, 1] });
    expect(a.p).toEqual({ '1-2': [1, 1], '1-3': [2, 1], '2-3': [1, 1] });
    expect(aggs.size).toBe(1);
  });

  it('lift = 조합 승률 - 각자 승률 평균, 판수 적은 조합 제외, lift 높은 순', () => {
    const agg: ComboAgg = { s: { 1: [100, 50], 2: [100, 50], 3: [100, 40] }, p: { '1-2': [10, 8], '1-3': [10, 4], '2-3': [3, 3] } };
    const c = computeCombos([agg], 8);
    expect(c.map((x) => [x.a, x.b, x.lift])).toEqual([[1, 2, 0.3], [1, 3, -0.05]]);
  });

  it('너무 많으면 1판짜리부터 지움', () => {
    const agg = emptyCombo();
    agg.p = { '1-2': [1, 0], '1-3': [5, 1], '2-3': [3, 1] };
    pruneCombo(agg, 2);
    expect(Object.keys(agg.p).sort()).toEqual(['1-3', '2-3']);
  });

  it('최신·직전 패치를 합쳐 응답', async () => {
    const r = new FakeRedis();
    await registerPatches(r, ['16.20', '16.21']);
    const a: ComboAgg = { s: { 1: [10, 5], 2: [10, 5] }, p: { '1-2': [5, 4] } };
    await saveCombos(r, new Map([[comboKey(2400, '16.21'), a], [comboKey(2400, '16.20'), a]]));
    const res = await getCombos(2400, r);
    expect(res.patches).toEqual(['16.21', '16.20']);
    expect(res.combos).toEqual([{ a: 1, b: 2, games: 10, winRate: 0.8, lift: 0.3 }]);
  });
});
