import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/aram/service', () => ({ getAramBuild: vi.fn() }));

import { getAramBuild } from '@/lib/aram/service';
import handler from '@/pages/api/aram/build';

function call(query: Record<string, string>, method = 'GET') {
  const res: any = {
    statusCode: 0,
    headers: {} as Record<string, string>,
    body: undefined as unknown,
    status(code: number) { this.statusCode = code; return this; },
    json(body: unknown) { this.body = body; return this; },
    setHeader(k: string, v: string) { this.headers[k] = v; },
  };
  return handler({ method, query } as any, res).then(() => res);
}

describe('GET /api/aram/build', () => {
  beforeEach(() => {
    vi.mocked(getAramBuild).mockReset();
  });

  it.each([
    [{ champion: 'abc', queue: '450' }],
    [{ champion: '0', queue: '450' }],
    [{ champion: '1', queue: '420' }],
    [{ queue: '450' }],
    [{ champion: '1', queue: '450', x: 'cache-buster' }],
  ])('잘못된 파라미터 %o 는 400이고 Redis를 건드리지 않는다', async (q) => {
    const res = await call(q as Record<string, string>);
    expect(res.statusCode).toBe(400);
    expect(getAramBuild).not.toHaveBeenCalled();
  });

  it('GET이 아니면 405', async () => {
    expect((await call({ champion: '1', queue: '450' }, 'POST')).statusCode).toBe(405);
  });

  it('성공하면 200 + 캐시 헤더', async () => {
    vi.mocked(getAramBuild).mockResolvedValue({ championId: 1 } as any);
    const res = await call({ champion: '1', queue: '2400' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ championId: 1 });
    expect(res.headers['Cache-Control']).toBe('s-maxage=300, stale-while-revalidate=600');
    expect(getAramBuild).toHaveBeenCalledWith(1, 2400);
  });

  it('Redis 오류면 503', async () => {
    vi.mocked(getAramBuild).mockRejectedValue(new Error('Upstash 명령 실패 (500)'));
    expect((await call({ champion: '1', queue: '450' })).statusCode).toBe(503);
  });
});
