import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { lcuGameToIngest } from '@/lib/aram/lcu';
import {
  aggKey, applySamples, emptyAgg, isEligible, isRecentPatch, patchOf, pruneAgg, runeKeyOf, samplesFromIngest, spellKey, type ChampAgg,
} from '@/lib/aram/aggregate';
import {
  CLASSES, DEFAULT_RUNE_KEY, RABADON, SORC_SHOES, makeIngestGame, makeIngestParticipant,
} from '@/test/fixtures/makeIngest';

describe('키 규칙', () => {
  it('패치는 앞 두 자리', () => expect(patchOf('16.21.123.4567')).toBe('16.21'));
  it('스펠은 순서 무관', () => expect(spellKey(32, 4)).toBe('4-32'));
  it('집계 키', () => expect(aggKey(2400, '16.21', 99)).toBe('aram:agg:2400:16.21:99'));
  it('룬 키 (파편 없음)', () => expect(runeKeyOf(8200, [8229, 8226, 8210, 8237, 8345, 8347], 8300)).toBe(DEFAULT_RUNE_KEY));
  it('룬이 6개가 아니면 null', () => expect(runeKeyOf(8200, [8229], 8300)).toBeNull());
  it('룬 값이 0이면 null (Mayhem LCU 기록은 룬이 전부 0)', () => {
    expect(runeKeyOf(0, [0, 0, 0, 0, 0, 0], 0)).toBeNull();
    expect(runeKeyOf(8200, [8229, 8226, 8210, 0, 8345, 8347], 8300)).toBeNull();
  });
  it('최근 패치 판정', () => {
    expect(isRecentPatch('16.21', '16.21')).toBe(true);
    expect(isRecentPatch('16.18', '16.21')).toBe(true);
    expect(isRecentPatch('16.17', '16.21')).toBe(false);
    expect(isRecentPatch('16.22', '16.21')).toBe(false); // 미래 패치
    expect(isRecentPatch('99.99', '16.21')).toBe(false);
    expect(isRecentPatch('16.24', '17.1')).toBe(true); // 연도 경계
    expect(isRecentPatch('16.20', '17.1')).toBe(false);
  });
});

describe('isEligible', () => {
  it('정상 Mayhem 경기', () => expect(isEligible(makeIngestGame())).toBe(true));
  it('다른 큐는 제외', () => expect(isEligible(makeIngestGame({ queueId: 420 as any }))).toBe(false));
  it('5분 미만은 제외', () => expect(isEligible(makeIngestGame({ gameDuration: 299 }))).toBe(false));
  it('조기 항복은 제외', () => expect(isEligible(makeIngestGame({ earlySurrender: true }))).toBe(false));
});

describe('samplesFromIngest', () => {
  it('10명분 표본', () => {
    const s = samplesFromIngest(makeIngestGame(), CLASSES);
    expect(s).toHaveLength(10);
    expect(s[0]).toEqual({
      queue: 2400, patch: '16.21', championId: 1, win: true, rune: DEFAULT_RUNE_KEY,
      spell: '4-32', items: [RABADON], boots: SORC_SHOES, augments: [1336, 1134, 3085, 1238],
    });
  });

  it('제외 대상 경기는 빈 배열', () => expect(samplesFromIngest(makeIngestGame({ gameDuration: 10 }), CLASSES)).toEqual([]));

  it('같은 완성 아이템이 두 칸에 있으면 한 번만, 신발 없으면 null', () => {
    const p = makeIngestParticipant({ items: [RABADON, RABADON, 0, 0, 0, 0, 0] });
    const s = samplesFromIngest(makeIngestGame({ participants: Array(10).fill(p) }), CLASSES)[0];
    expect(s.items).toEqual([RABADON]);
    expect(s.boots).toBeNull();
  });

  it('같은 증강이 여러 번 와도 한 번만', () => {
    const p = makeIngestParticipant({ augments: [7, 7, 7, 9] });
    expect(samplesFromIngest(makeIngestGame({ participants: Array(10).fill(p) }), CLASSES)[0].augments).toEqual([7, 9]);
  });

  it('실제 LCU Mayhem 경기(가명 처리): 룬은 null, 증강은 채워짐', () => {
    const g = lcuGameToIngest(JSON.parse(readFileSync('test/fixtures/lcu-game-2400.json', 'utf8')))!;
    const s = samplesFromIngest(g, CLASSES);
    expect(s).toHaveLength(10);
    expect(s.every((x) => x.rune === null)).toBe(true);
    expect(s.every((x) => x.augments.length === 4)).toBe(true);
  });

  it('증강 0은 버린다', () => {
    const p = makeIngestParticipant({ augments: [7, 0, 9] });
    expect(samplesFromIngest(makeIngestGame({ participants: Array(10).fill(p) }), CLASSES)[0].augments).toEqual([7, 9]);
  });
});

describe('applySamples / pruneAgg', () => {
  it('챔피언별로 판수·승수와 항목을 누적', () => {
    const aggs = new Map<string, ChampAgg>();
    const samples = samplesFromIngest(makeIngestGame(), CLASSES);
    applySamples(aggs, samples);
    applySamples(aggs, samples);
    const a = aggs.get(aggKey(2400, '16.21', 1))!;
    expect(a.g).toBe(2);
    expect(a.w).toBe(2);
    expect(a.r[DEFAULT_RUNE_KEY]).toEqual([2, 2]);
    expect(a.s['4-32']).toEqual([2, 2]);
    expect(a.i[String(RABADON)]).toEqual([2, 2]);
    expect(a.b[String(SORC_SHOES)]).toEqual([2, 2]);
    expect(a.a['1336']).toEqual([2, 2]);
    expect(aggs.get(aggKey(2400, '16.21', 6))!.w).toBe(0); // 6번 챔피언은 패배 팀
  });

  it('항목이 max를 넘으면 판수 1 이하를 지운다', () => {
    const a = emptyAgg();
    for (let i = 0; i < 5; i++) a.r[`k${i}`] = [1, 0];
    a.r.keep = [3, 1];
    pruneAgg(a, 4);
    expect(Object.keys(a.r)).toEqual(['keep']);
  });

  it('2판 이상 항목이 max를 넘어도 상위 max개만 남긴다', () => {
    const a = emptyAgg();
    for (let i = 0; i < 6; i++) a.a[`x${i}`] = [i + 2, 0];
    pruneAgg(a, 4);
    expect(Object.keys(a.a).sort()).toEqual(['x2', 'x3', 'x4', 'x5']);
  });
});

describe('isRecentPatch 범위', () => {
  it('maxBack으로 넓힐 수 있음', () => {
    expect(isRecentPatch('16.9', '16.21')).toBe(false);
    expect(isRecentPatch('16.9', '16.21', 12)).toBe(true);
    expect(isRecentPatch('16.8', '16.21', 12)).toBe(false);
  });
});
