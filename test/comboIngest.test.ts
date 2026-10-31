import { describe, expect, it } from 'vitest';
import { COMBO_SEEN_KEY, MAX_COMBO_SAMPLES, ingestComboSamples, isValidComboSample, parseComboRequest } from '@/lib/aram/comboIngest';
import { comboKey, loadCombos } from '@/lib/aram/combos';
import { ingestGames } from '@/lib/aram/ingest';
import { FakeRedis } from '@/test/fakeRedis';
import { CLASSES, makeIngestGame, makeIngestParticipant } from '@/test/fixtures/makeIngest';

const sample = (over: Record<string, unknown> = {}) => ({
  gameId: 1, gameVersion: '16.21.1', gameDuration: 1200, earlySurrender: false, championId: 10, win: true, augments: [1, 2, 3], ...over,
});

describe('조합 표본 검증', () => {
  it('정상 / 잘못된 값', () => {
    expect(isValidComboSample(sample())).toBe(true);
    expect(isValidComboSample(sample({ augments: [1, 2, 3, 4, 5, 6, 7] }))).toBe(false);
    expect(isValidComboSample(sample({ win: 'true' }))).toBe(false);
    expect(isValidComboSample(sample({ gameVersion: 'x' }))).toBe(false);
  });
  it('요청은 1~200개', () => {
    expect(parseComboRequest({ samples: [1] })).toEqual({ samples: [1] });
    expect(parseComboRequest({ samples: [] })).toBeNull();
    expect(parseComboRequest({ samples: Array(MAX_COMBO_SAMPLES + 1).fill(1) })).toBeNull();
  });
});

describe('ingestComboSamples', () => {
  it('조합에 더하고, 같은 판·챔피언은 다시 세지 않음, 짧은 판·증강 1개·오래된 패치는 거부', async () => {
    const r = new FakeRedis();
    const res = await ingestComboSamples(r, '16.21', [
      sample(),
      sample(), // 같은 요청 안 중복
      sample({ gameId: 2, gameDuration: 200 }),
      sample({ gameId: 3, augments: [1, 0] }),
      sample({ gameId: 4, gameVersion: '15.1.1' }),
    ]);
    expect(res).toEqual({ accepted: 1, duplicates: 1, rejected: 3 });
    const agg = (await loadCombos(r, [comboKey(2400, '16.21')])).get(comboKey(2400, '16.21'))!;
    expect(agg.p).toEqual({ '1-2': [1, 1], '1-3': [1, 1], '2-3': [1, 1] });
    expect(await ingestComboSamples(r, '16.21', [sample()])).toEqual({ accepted: 0, duplicates: 1, rejected: 0 });
  });

  it('경기 상세로 먼저 센 사람은 전적 목록으로 다시 세지 않음 (반대도)', async () => {
    const r = new FakeRedis();
    const p = (championId: number) => makeIngestParticipant({ championId, augments: [1, 2] });
    const game = makeIngestGame({ gameId: 50, queueId: 2400, participants: Array.from({ length: 10 }, (_, i) => p(i + 1)) });
    await ingestGames(r, '16.21', [game], CLASSES);
    const seen = await r.cmd<number[]>(['SMISMEMBER', COMBO_SEEN_KEY, '50:1', '50:10']);
    expect(seen).toEqual([1, 1]);
    const res = await ingestComboSamples(r, '16.21', [sample({ gameId: 50, championId: 1, gameVersion: game.gameVersion })]);
    expect(res).toMatchObject({ accepted: 0, duplicates: 1 });
  });
});
