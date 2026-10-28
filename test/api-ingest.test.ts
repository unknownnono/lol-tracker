import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/aram/ingest', async (orig) => ({
  ...(await orig<typeof import('@/lib/aram/ingest')>()),
  ingestGames: vi.fn(),
}));
vi.mock('@/lib/aram/items', () => ({ getItemClasses: vi.fn(async () => ({ completed: new Set(), boots: new Set() })) }));
vi.mock('@/lib/riot', () => ({ getLatestDdragonVersion: vi.fn(async () => '16.21.1') }));
vi.mock('@/lib/aram/redis', async () => {
  const { FakeRedis } = await import('@/test/fakeRedis');
  return { upstash: new FakeRedis() };
});

import { ingestGames } from '@/lib/aram/ingest';
import handler, { config } from '@/pages/api/aram/ingest';

const KEY = 'test-ingest-key-1234567890';

function call(opts: { method?: string; key?: string; body?: unknown; ip?: string }) {
  const res: any = {
    statusCode: 0,
    headers: {} as Record<string, string>,
    body: undefined as unknown,
    status(code: number) { this.statusCode = code; return this; },
    json(body: unknown) { this.body = body; return this; },
    setHeader(k: string, v: string) { this.headers[k] = v; },
  };
  const headers: Record<string, string> = {};
  if (opts.key !== undefined) headers['x-ingest-key'] = opts.key;
  headers['x-forwarded-for'] = opts.ip ?? `10.0.0.${Math.floor(Math.random() * 250)}`;
  return handler({ method: opts.method ?? 'POST', headers, body: opts.body ?? { games: [{}] } } as any, res).then(() => res);
}

describe('POST /api/aram/ingest', () => {
  beforeEach(() => {
    vi.stubEnv('INGEST_KEY', KEY);
    vi.mocked(ingestGames).mockReset();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('본문 크기 상한 200kb', () => expect(config.api.bodyParser.sizeLimit).toBe('200kb'));

  it('POST가 아니면 405', async () => expect((await call({ method: 'GET', key: KEY })).statusCode).toBe(405));

  it('서버에 키가 없으면 503, 집계하지 않는다', async () => {
    vi.stubEnv('INGEST_KEY', '');
    expect((await call({ key: KEY })).statusCode).toBe(503);
    expect(ingestGames).not.toHaveBeenCalled();
  });

  it.each([['키 없음', undefined], ['틀린 키', 'wrong'], ['길이 같은 틀린 키', 'x'.repeat(KEY.length)]])(
    '%s → 401, 집계하지 않는다',
    async (_, key) => {
      expect((await call({ key })).statusCode).toBe(401);
      expect(ingestGames).not.toHaveBeenCalled();
    },
  );

  it('본문 형식이 틀리면 400', async () => {
    expect((await call({ key: KEY, body: { games: [] } })).statusCode).toBe(400);
    expect(ingestGames).not.toHaveBeenCalled();
  });

  it('성공하면 200 + 결과 + no-store', async () => {
    vi.mocked(ingestGames).mockResolvedValue({ accepted: 1, duplicates: 0, rejected: 0 });
    const res = await call({ key: KEY });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ accepted: 1, duplicates: 0, rejected: 0 });
    expect(res.headers['Cache-Control']).toBe('no-store');
  });

  it('최신 패치를 넘겨준다', async () => {
    vi.mocked(ingestGames).mockResolvedValue({ accepted: 0, duplicates: 0, rejected: 0 });
    await call({ key: KEY });
    expect(vi.mocked(ingestGames).mock.calls[0][1]).toBe('16.21');
  });

  it('같은 IP는 1분에 10번까지, 넘으면 429', async () => {
    vi.mocked(ingestGames).mockResolvedValue({ accepted: 0, duplicates: 0, rejected: 0 });
    for (let i = 0; i < 10; i++) expect((await call({ key: KEY, ip: '1.2.3.4' })).statusCode).toBe(200);
    const res = await call({ key: KEY, ip: '1.2.3.4' });
    expect(res.statusCode).toBe(429);
    expect(res.body).toMatchObject({ retryAfter: 60 });
    expect((await call({ key: KEY, ip: '5.6.7.8' })).statusCode).toBe(200);
  });

  it('잠금 실패는 503 + retryAfter', async () => {
    vi.mocked(ingestGames).mockResolvedValue('locked');
    const res = await call({ key: KEY });
    expect(res.statusCode).toBe(503);
    expect(res.body).toMatchObject({ retryAfter: 5 });
  });

  it('저장소 오류는 503', async () => {
    vi.mocked(ingestGames).mockRejectedValue(new Error('Upstash 명령 실패 (500)'));
    expect((await call({ key: KEY })).statusCode).toBe(503);
  });
});
