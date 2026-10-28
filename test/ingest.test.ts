import { describe, expect, it } from 'vitest';
import { aggKey } from '@/lib/aram/aggregate';
import { MAX_GAMES, ingestGames, isValidGame, parseIngestRequest } from '@/lib/aram/ingest';
import { LOCK_KEY, loadAggs, latestPatches } from '@/lib/aram/store';
import { FakeRedis } from '@/test/fakeRedis';
import { CLASSES, makeIngestGame, makeIngestParticipant } from '@/test/fixtures/makeIngest';

describe('isValidGame', () => {
  it('정상 경기', () => expect(isValidGame(makeIngestGame())).toBe(true));
  it.each([
    ['gameId 없음', { ...makeIngestGame(), gameId: undefined }],
    ['gameId 소수', { ...makeIngestGame(), gameId: 1.5 }],
    ['gameVersion 형식', { ...makeIngestGame(), gameVersion: 'abc' }],
    ['gameVersion 꼬리 문자', { ...makeIngestGame(), gameVersion: '16.21x' }],
    ['gameVersion 자릿수', { ...makeIngestGame(), gameVersion: '160.21.1' }],
    ['챔피언 ID 1000 이상', makeIngestGame({ participants: Array(10).fill(makeIngestParticipant({ championId: 1000 })) })],
    ['증강 ID 너무 큼', makeIngestGame({ participants: Array(10).fill(makeIngestParticipant({ augments: [100000] })) })],
    ['아이템 ID 너무 큼', makeIngestGame({ participants: Array(10).fill(makeIngestParticipant({ items: [1000000, 0, 0, 0, 0, 0, 0] })) })],
    ['참가자 9명', makeIngestGame({ participants: makeIngestGame().participants.slice(0, 9) })],
    ['아이템 6칸', makeIngestGame({ participants: Array(10).fill(makeIngestParticipant({ items: [1, 2, 3, 4, 5, 6] })) })],
    ['룬 5개', makeIngestGame({ participants: Array(10).fill(makeIngestParticipant({ perks: [1, 2, 3, 4, 5] })) })],
    ['증강 7개', makeIngestGame({ participants: Array(10).fill(makeIngestParticipant({ augments: [1, 2, 3, 4, 5, 6, 7] })) })],
    ['win 문자열', makeIngestGame({ participants: Array(10).fill({ ...makeIngestParticipant(), win: 'true' }) })],
    ['음수 아이템', makeIngestGame({ participants: Array(10).fill(makeIngestParticipant({ items: [-1, 0, 0, 0, 0, 0, 0] })) })],
    ['null', null],
  ])('%s → 거부', (_, g) => expect(isValidGame(g)).toBe(false));
});

describe('parseIngestRequest', () => {
  it('정상', () => expect(parseIngestRequest({ games: [1] })).toEqual({ games: [1] }));
  it.each([
    ['객체 아님', 'x'],
    ['games 없음', {}],
    ['games 비어 있음', { games: [] }],
    [`${MAX_GAMES + 1}개`, { games: Array(MAX_GAMES + 1).fill(1) }],
  ])('%s → null', (_, body) => expect(parseIngestRequest(body)).toBeNull());
});

describe('ingestGames', () => {
  it('새 경기를 집계하고 패치·처리 기록을 남긴다', async () => {
    const r = new FakeRedis();
    expect(await ingestGames(r, '16.21', [makeIngestGame()], CLASSES)).toEqual({ accepted: 1, duplicates: 0, rejected: 0 });
    const aggs = await loadAggs(r, [aggKey(2400, '16.21', 1)]);
    expect(aggs.get(aggKey(2400, '16.21', 1))!.g).toBe(1);
    expect(await latestPatches(r, 1)).toEqual(['16.21']);
    expect(r.sets.get('aram:seen:game')).toEqual(new Set(['1000000001']));
    expect(r.strings.has(LOCK_KEY)).toBe(false);
  });

  it('재전송은 duplicates로 세고 다시 집계하지 않는다', async () => {
    const r = new FakeRedis();
    await ingestGames(r, '16.21', [makeIngestGame()], CLASSES);
    expect(await ingestGames(r, '16.21', [makeIngestGame()], CLASSES)).toEqual({ accepted: 0, duplicates: 1, rejected: 0 });
    expect((await loadAggs(r, [aggKey(2400, '16.21', 1)])).get(aggKey(2400, '16.21', 1))!.g).toBe(1);
  });

  it('같은 묶음 안 중복도 한 번만', async () => {
    const r = new FakeRedis();
    expect(await ingestGames(r, '16.21', [makeIngestGame(), makeIngestGame()], CLASSES)).toEqual({ accepted: 1, duplicates: 1, rejected: 0 });
    expect((await loadAggs(r, [aggKey(2400, '16.21', 1)])).get(aggKey(2400, '16.21', 1))!.g).toBe(1);
  });

  it('일부만 틀린 묶음: 틀린 것과 제외 대상은 rejected, 나머지는 집계', async () => {
    const r = new FakeRedis();
    const games = [makeIngestGame(), { bad: true }, makeIngestGame({ gameId: 2, earlySurrender: true })];
    expect(await ingestGames(r, '16.21', games, CLASSES)).toEqual({ accepted: 1, duplicates: 0, rejected: 2 });
  });

  it('최근 패치(최신 포함 4개)가 아닌 경기는 rejected', async () => {
    const r = new FakeRedis();
    const games = [makeIngestGame({ gameId: 1, gameVersion: '99.99.1.1' }), makeIngestGame({ gameId: 2, gameVersion: '16.10.1.1' })];
    expect(await ingestGames(r, '16.21', games, CLASSES)).toEqual({ accepted: 0, duplicates: 0, rejected: 2 });
    expect(await latestPatches(r, 1)).toEqual([]);
  });

  it('집계할 경기가 없으면 잠금도 잡지 않는다', async () => {
    const r = new FakeRedis();
    expect(await ingestGames(r, '16.21', [{ bad: true }], CLASSES)).toEqual({ accepted: 0, duplicates: 0, rejected: 1 });
    expect(r.log).toEqual([]);
  });

  it('잠겨 있으면 locked, 집계하지 않는다', async () => {
    const r = new FakeRedis();
    await r.cmd(['SET', LOCK_KEY, 'other']);
    expect(await ingestGames(r, '16.21', [makeIngestGame()], CLASSES)).toBe('locked');
    expect(r.sets.get('aram:seen:game')).toBeUndefined();
  });

  it('도중에 Redis가 실패해도 잠금을 풀고 예외를 던진다', async () => {
    class Broken extends FakeRedis {
      async cmd<T = unknown>(args: (string | number)[]): Promise<T> {
        if (args[0] === 'MSET') throw new Error('Upstash 명령 실패 (500)');
        return super.cmd<T>(args);
      }
    }
    const r = new Broken();
    await expect(ingestGames(r, '16.21', [makeIngestGame()], CLASSES)).rejects.toThrow('Upstash');
    expect(r.strings.has(LOCK_KEY)).toBe(false);
    expect(r.sets.get('aram:seen:game')).toBeUndefined();
  });
});
