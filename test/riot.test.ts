import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/rateLimit', () => ({
  acquire: vi.fn(async () => true),
  blockFor: vi.fn(async () => {}),
}));

import { acquire, blockFor } from '@/lib/rateLimit';
import { getAccountByRiotId, getFullSummonerProfile, riotRequest, RiotApiError } from '@/lib/riot';

// 예외를 돌려받아 필드를 검사하기 위한 도우미 (예외가 안 나면 테스트 실패)
async function rejection(p: Promise<unknown>): Promise<RiotApiError> {
  try {
    await p;
  } catch (e) {
    return e as RiotApiError;
  }
  throw new Error('예외가 나야 합니다');
}

describe('riot', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    vi.stubEnv('RIOT_API_KEY', 'test-key');
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    fetchMock.mockReset();
    vi.mocked(acquire).mockClear();
    vi.mocked(blockFor).mockClear();
  });

  it('riotRequest는 429면 Retry-After만큼 차단하고 RiotApiError(429)', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 429, headers: { 'Retry-After': '7' } }));
    const err = await rejection(riotRequest('https://asia.api.riotgames.com/x'));
    expect(err).toBeInstanceOf(RiotApiError);
    expect(err.status).toBe(429);
    expect(blockFor).toHaveBeenCalledWith(expect.anything(), 7);
  });

  it('서비스 장애 429(X-Rate-Limit-Type: service)는 전역 차단하지 않는다', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 429, headers: { 'X-Rate-Limit-Type': 'service' } }));
    expect((await rejection(riotRequest('https://asia.api.riotgames.com/x'))).status).toBe(429);
    expect(blockFor).not.toHaveBeenCalled();
  });

  it('riotRequest는 시간 제한 신호를 붙인다', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({})));
    await riotRequest('https://asia.api.riotgames.com/z');
    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });

  it('전적 검색 1회는 한도를 한 번에 15회 예약하고, 거부되면 Riot을 부르지 않는다', async () => {
    vi.mocked(acquire).mockResolvedValueOnce(false);
    expect((await rejection(getFullSummonerProfile('새이름', 'KR9', 'kr'))).status).toBe(429);
    expect(acquire).toHaveBeenCalledTimes(1);
    expect(acquire).toHaveBeenCalledWith(expect.anything(), 15);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('riotRequest는 키를 헤더로 보낸다', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: 1 })));
    await expect(riotRequest('https://asia.api.riotgames.com/y')).resolves.toEqual({ ok: 1 });
    expect(fetchMock.mock.calls[0][1].headers['X-Riot-Token']).toBe('test-key');
  });

  it('검색 호출은 한도기를 거치고, 거부되면 fetch 없이 429', async () => {
    vi.mocked(acquire).mockResolvedValueOnce(false);
    const err = await rejection(getAccountByRiotId('없는이름', 'KR1', 'kr'));
    expect(err.status).toBe(429);
    expect(acquire).toHaveBeenCalledWith(expect.anything(), 1);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
