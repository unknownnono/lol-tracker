import { describe, expect, it } from 'vitest';
import {
  applySkillSamples, computeSkills, emptySkillAgg, maxOrder, mergeSkillAggs, pruneSkillAgg, skillKey, skillSamples, skillSequence,
} from '@/lib/aram/skills';

const SLOT: Record<string, number> = { Q: 1, W: 2, E: 3, R: 4 };
// participantId별 스킬 순서로 타임라인을 만듭니다 (프레임 두 개로 나눠 담아 순서 정렬도 확인).
function timeline(seqs: Record<number, string>, evolve = false) {
  const events = Object.entries(seqs).flatMap(([pid, seq]) =>
    [...seq].map((s, i) => ({ type: 'SKILL_LEVEL_UP', participantId: Number(pid), skillSlot: SLOT[s], levelUpType: 'NORMAL', timestamp: 1000 * (i + 1) })),
  );
  if (evolve) events.push({ type: 'SKILL_LEVEL_UP', participantId: 1, skillSlot: 1, levelUpType: 'EVOLVE', timestamp: 500 });
  const half = Math.floor(events.length / 2);
  return { info: { frames: [{ events: events.slice(half) }, { events: [...events.slice(0, half), { type: 'ITEM_PURCHASED' }] }] } };
}

const match = (over: Record<string, unknown> = {}) => ({
  info: {
    queueId: 450,
    gameDuration: 1200,
    participants: [
      { participantId: 1, championId: 103, win: true },
      { participantId: 2, championId: 22, win: false },
      { participantId: 3, championId: 99, win: false, gameEndedInEarlySurrender: true },
    ],
    ...over,
  },
});

describe('skillSequence / maxOrder', () => {
  it('시간순, 진화 제외', () => expect(skillSequence(timeline({ 1: 'QWEQ' }, true), 1)).toBe('QWEQ'));
  it('5레벨에 먼저 닿은 순', () => {
    expect(maxOrder('QWEQQRQEQEREEWW')).toBe('QEW');
    expect(maxOrder('QEWEEREQEQRQQWW')).toBe('EQW');
  });
  it('끝까지 못 찍었으면 많이 찍은 순, 같으면 먼저 찍은 순', () => {
    expect(maxOrder('QWEWWQ')).toBe('WQE');
    expect(maxOrder('EQW')).toBe('EQW');
  });
});

describe('skillSamples', () => {
  const seq = 'QWEQQRQEQEREEWWWW';
  it('15레벨까지 자르고, 조기 항복·15레벨 전에 끝난 판 제외', () => {
    const s = skillSamples(match(), timeline({ 1: seq, 2: seq.slice(0, 14), 3: seq }));
    expect(s).toEqual([{ championId: 103, win: true, seq: seq.slice(0, 15), order: 'QEW' }]);
  });
  it('일반 칼바람이 아니거나 5분 미만이면 없음', () => {
    expect(skillSamples(match({ queueId: 420 }), timeline({ 1: seq }))).toEqual([]);
    expect(skillSamples(match({ gameDuration: 200 }), timeline({ 1: seq }))).toEqual([]);
  });
});

describe('누적·조회', () => {
  it('챔피언별로 쌓고 상위 순서를 계산 (3판 미만 순서는 숨김)', () => {
    const A = 'QWEQQRQEQEREEWW';
    const B = 'QWEEEREQEQRQQWW';
    const aggs = new Map();
    const s = (win: boolean, seq: string, order: string) => ({ championId: 103, win, seq, order });
    applySkillSamples(aggs, [s(true, A, 'QEW'), s(false, A, 'QEW'), s(true, A, 'QEW'), s(true, B, 'EQW')]);
    const agg = aggs.get(skillKey(103));
    expect(agg).toMatchObject({ g: 4, w: 3, q: { [A]: [3, 2], [B]: [1, 1] }, m: { QEW: [3, 2], EQW: [1, 1] } });
    expect(computeSkills(agg)).toEqual({
      queue: 450,
      sampleSize: 4,
      orders: [{ key: 'QEW', games: 3, winRate: 0.6667, pickRate: 0.75 }],
      sequences: [{ key: A, games: 3, winRate: 0.6667, pickRate: 0.75 }],
    });
    expect(computeSkills(null)).toBeNull();
  });
  it('예전에 쌓인 15칸 미만 순서는 숨김', () => {
    const full = 'QWEQQRQEQEREEWW';
    const s = computeSkills({ g: 8, w: 4, q: { [full]: [5, 3], [full.slice(0, 14)]: [3, 1] }, m: { QEW: [8, 4] } });
    expect(s?.sequences.map((x) => x.key)).toEqual([full]);
  });
  it('합치기·정리', () => {
    const a = { ...emptySkillAgg(), g: 1, w: 1, q: { X: [1, 1] as [number, number] } };
    expect(mergeSkillAggs(a, a)).toMatchObject({ g: 2, w: 2, q: { X: [2, 2] } });
    const big = emptySkillAgg();
    for (let i = 0; i < 50; i++) big.q[`s${i}`] = [i < 5 ? 3 : 1, 0];
    pruneSkillAgg(big, 40);
    expect(Object.keys(big.q)).toHaveLength(5);
  });
});
