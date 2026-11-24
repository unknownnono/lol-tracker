import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/riot', async (orig) => ({ ...(await orig<typeof import('@/lib/riot')>()), getLeagueEntries: vi.fn() }));
vi.mock('@/lib/aram/redis', async () => {
  const { FakeRedis } = await import('@/test/fakeRedis');
  return { upstash: new FakeRedis() };
});

import { getLeagueEntries } from '@/lib/riot';
import handler from '@/pages/api/aram/rank';

const KEY = 'test-ingest-key-1234567890';
const PUUID = 'a'.repeat(78);

function call(opts: { method?: string; key?: string; query?: Record<string, string> }) {
  const res: any = {
    statusCode: 0,
    headers: {} as Record<string, string>,
    body: undefined as unknown,
    status(code: number) { this.statusCode = code; return this; },
    json(body: unknown) { this.body = body; return this; },
    setHeader(k: string, v: string) { this.headers[k] = v; },
  };
  const headers: Record<string, string> = { 'x-forwarded-for': `10.1.0.${Math.floor(Math.random() * 250)}` };
  if (opts.key !== undefined) headers['x-ingest-key'] = opts.key;
  return handler({ method: opts.method ?? 'GET', headers, query: opts.query ?? { puuid: PUUID } } as any, res).then(() => res);
}

describe('GET /api/aram/rank', () => {
  beforeEach(() => {
    vi.stubEnv('INGEST_KEY', KEY);
    vi.mocked(getLeagueEntries).mockReset();
  });
  afterEach(() => vi.unstubAllEnvs());

  it('키가 없거나 틀리면 401, Riot API를 부르지 않음', async () => {
    expect((await call({})).statusCode).toBe(401);
    expect((await call({ key: 'wrong' })).statusCode).toBe(401);
    expect(getLeagueEntries).not.toHaveBeenCalled();
  });
  it('puuid가 이상하면 400', async () => {
    expect((await call({ key: KEY, query: { puuid: 'x/../y' } })).statusCode).toBe(400);
    expect((await call({ key: KEY, query: { puuid: PUUID, other: '1' } })).statusCode).toBe(400);
  });
  it('솔로·자유 랭크의 승·패', async () => {
    vi.mocked(getLeagueEntries).mockResolvedValue([
      { queueType: 'RANKED_SOLO_5x5', tier: 'PLATINUM', rank: 'III', leaguePoints: 0, wins: 14, losses: 11 },
    ]);
    const r = await call({ key: KEY });
    expect(r.statusCode).toBe(200);
    expect(r.body).toEqual({ solo: { tier: 'PLATINUM', division: 'III', lp: 0, wins: 14, losses: 11 }, flex: null });
    expect(getLeagueEntries).toHaveBeenCalledWith(PUUID, 'kr');
  });
});
