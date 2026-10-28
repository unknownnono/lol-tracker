import { describe, expect, it } from 'vitest';
import { emptyAgg } from '@/lib/aram/aggregate';
import {
  filterUnseenGames, latestPatches, loadAggs, markGamesSeen, patchScore, registerPatches, saveAggs, tryLock, unlock,
} from '@/lib/aram/store';
import { FakeRedis } from '@/test/fakeRedis';

describe('store', () => {
  it('누적값은 MSET 한 번으로 쓰고 MGET 한 번으로 읽는다', async () => {
    const r = new FakeRedis();
    const a = { ...emptyAgg(), g: 3, w: 1 };
    await saveAggs(r, new Map([['k1', a]]));
    const got = await loadAggs(r, ['k1', 'k2']);
    expect(got.get('k1')).toEqual(a);
    expect(got.has('k2')).toBe(false);
    expect(r.log.map((c) => c[0])).toEqual(['MSET', 'MGET']);
  });

  it('빈 입력이면 Redis를 부르지 않는다', async () => {
    const r = new FakeRedis();
    await saveAggs(r, new Map());
    await loadAggs(r, []);
    await registerPatches(r, []);
    await markGamesSeen(r, []);
    expect(await filterUnseenGames(r, [])).toEqual([]);
    expect(r.log).toEqual([]);
  });

  it('패치는 숫자 크기순 (16.9 < 16.10)', async () => {
    expect(patchScore('16.10')).toBeGreaterThan(patchScore('16.9'));
    const r = new FakeRedis();
    await registerPatches(r, ['16.9', '16.10']);
    await registerPatches(r, ['15.24']);
    expect(await latestPatches(r, 2)).toEqual(['16.10', '16.9']);
  });

  it('처리한 경기 걸러내기 (aram:seen:game)', async () => {
    const r = new FakeRedis();
    await markGamesSeen(r, ['1']);
    expect(await filterUnseenGames(r, ['1', '2'])).toEqual(['2']);
    expect(r.sets.get('aram:seen:game')).toEqual(new Set(['1']));
  });

  it('잠금은 토큰을 돌려주고, 자기 토큰일 때만 해제한다', async () => {
    const r = new FakeRedis();
    const t1 = await tryLock(r);
    expect(t1).toEqual(expect.any(String));
    expect(await tryLock(r)).toBeNull();
    await unlock(r, 'someone-else');
    expect(await tryLock(r)).toBeNull(); // 남의 토큰으로는 안 풀린다
    await unlock(r, t1!);
    expect(await tryLock(r)).toEqual(expect.any(String));
  });
});
