import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { kvCommand, kvPipeline } from '@/lib/kv';

describe('kv', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://kv.example');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'tok');
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  it('kvCommand는 명령 배열을 루트 URL로 POST하고 result를 돌려준다', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ result: 'OK' })));
    await expect(kvCommand(['SET', 'a', 1])).resolves.toBe('OK');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://kv.example');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer tok');
    expect(JSON.parse(init.body)).toEqual(['SET', 'a', 1]);
  });

  it('kvPipeline은 /pipeline으로 보내고 결과 배열을 돌려준다', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify([{ result: 1 }, { result: null }])));
    await expect(kvPipeline([['INCRBY', 'x', 1], ['GET', 'y']])).resolves.toEqual([1, null]);
    expect(fetchMock.mock.calls[0][0]).toBe('https://kv.example/pipeline');
  });

  it('파이프라인 항목에 error가 있으면 예외', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify([{ result: 1 }, { error: 'WRONGTYPE' }])));
    await expect(kvPipeline([['INCRBY', 'x', 1], ['GET', 'y']])).rejects.toThrow('WRONGTYPE');
  });

  it('URL 자리에 토큰 같은 값이 들어가면 값을 노출하지 않고 예외', async () => {
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'secret-token-value');
    const err = (await kvCommand(['GET', 'a']).catch((e: unknown) => e)) as Error;
    expect(err.message).toContain('https://');
    expect(err.message).not.toContain('secret-token-value');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('환경변수가 없으면 예외', async () => {
    vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
    await expect(kvCommand(['GET', 'a'])).rejects.toThrow('UPSTASH_REDIS_REST_URL');
  });
});
