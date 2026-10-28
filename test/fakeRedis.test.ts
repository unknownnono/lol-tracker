import { describe, expect, it } from 'vitest';
import { FakeRedis } from '@/test/fakeRedis';

describe('FakeRedis', () => {
  it('SET NX는 이미 있으면 null', async () => {
    const r = new FakeRedis();
    expect(await r.cmd(['SET', 'k', '1', 'NX', 'EX', 60])).toBe('OK');
    expect(await r.cmd(['SET', 'k', '2', 'NX', 'EX', 60])).toBeNull();
    expect(await r.cmd(['GET', 'k'])).toBe('1');
  });

  it('리스트: RPUSH, LPUSH, LPOP, LTRIM, LLEN', async () => {
    const r = new FakeRedis();
    await r.cmd(['RPUSH', 'q', 'a', 'b', 'c']);
    await r.cmd(['LPUSH', 'q', 'z']);
    await r.cmd(['LTRIM', 'q', 0, 2]);
    expect(await r.cmd(['LLEN', 'q'])).toBe(3);
    expect(await r.cmd(['LPOP', 'q'])).toBe('z');
    expect(await r.cmd(['LPOP', 'q'])).toBe('a');
  });

  it('집합과 정렬 집합', async () => {
    const r = new FakeRedis();
    await r.cmd(['SADD', 's', 'x']);
    expect(await r.cmd(['SMISMEMBER', 's', 'x', 'y'])).toEqual([1, 0]);
    await r.cmd(['ZADD', 'z', 16020, '16.20', 16021, '16.21']);
    expect(await r.cmd(['ZREVRANGE', 'z', 0, 1])).toEqual(['16.21', '16.20']);
  });

  it('MGET/MSET, INCRBY/DECRBY, pipe', async () => {
    const r = new FakeRedis();
    await r.cmd(['MSET', 'a', '1', 'b', '2']);
    expect(await r.cmd(['MGET', 'a', 'b', 'c'])).toEqual(['1', '2', null]);
    expect(await r.pipe([['INCRBY', 'n', 5], ['DECRBY', 'n', 2]])).toEqual([5, 3]);
    expect(r.log).toHaveLength(4);
  });
});
