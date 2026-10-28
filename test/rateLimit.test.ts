import { describe, expect, it } from 'vitest';
import { acquire, blockFor, decide, LIMITS, windowKeys } from '@/lib/rateLimit';
import { FakeRedis } from '@/test/fakeRedis';
import type { RedisLike } from '@/lib/aram/redis';

const WIN = 120_000;
const T0 = 15_000_000 * WIN; // 2분 창의 정확한 시작 시각

describe('decide', () => {
  const ok = { sec: 1, win: 1, blocked: false };
  it('한도 이내면 허용', () => expect(decide(ok)).toBe(true));
  it('차단 중이면 거부', () => expect(decide({ ...ok, blocked: true })).toBe(false));
  it('초당 한도 초과면 거부', () => expect(decide({ ...ok, sec: LIMITS.searchPerSecond + 1 })).toBe(false));
  it('2분 한도 초과면 거부', () => expect(decide({ ...ok, win: LIMITS.perTwoMinutes + 1 })).toBe(false));
});

describe('windowKeys', () => {
  it('현재 창 경과 비율과 이전 창 키', () => {
    const k = windowKeys(T0 + 30_000);
    expect(k.frac).toBe(0.25);
    expect(k.prevWin).toBe(`rl:120s:${T0 / WIN - 1}`);
  });
});

describe('acquire', () => {
  it('초당 16회까지', async () => {
    const r = new FakeRedis();
    expect(await acquire(r, 15, T0)).toBe(true);
    expect(await acquire(r, 1, T0 + 10)).toBe(true);
    expect(await acquire(r, 1, T0 + 20)).toBe(false);
  });

  it('거부되면 카운터를 되돌린다', async () => {
    const r = new FakeRedis();
    await acquire(r, 16, T0);
    await acquire(r, 5, T0 + 10);
    expect(r.strings.get(`rl:1s:${T0 / 1000}`)).toBe('16');
    expect(r.strings.get(`rl:120s:${T0 / WIN}`)).toBe('16');
  });

  it('이전 창 사용량을 남은 비율만큼 더한다 (슬라이딩 창)', async () => {
    const r = new FakeRedis();
    r.strings.set(`rl:120s:${T0 / WIN - 1}`, '90');
    expect(await acquire(r, 1, T0 + 12_000)).toBe(true); // 1 + 81 = 82
    expect(await acquire(r, 9, T0 + 13_000)).toBe(false); // 10 + 80.25 > 90
    expect(await acquire(r, 9, T0 + 60_000)).toBe(true); // 10 + 45
  });

  it('blockFor 이후에는 거부', async () => {
    const r = new FakeRedis();
    await blockFor(r, 7);
    expect(r.log.at(-1)).toEqual(['SET', 'rl:block', '1', 'EX', 7]);
    expect(await acquire(r, 1, T0)).toBe(false);
  });

  it('Redis 오류 시 허용 (Upstash 없는 로컬에서도 검색 동작)', async () => {
    const broken: RedisLike = {
      cmd: async () => { throw new Error('UPSTASH 미설정'); },
      pipe: async () => { throw new Error('UPSTASH 미설정'); },
    };
    expect(await acquire(broken, 1, T0)).toBe(true);
  });
});
