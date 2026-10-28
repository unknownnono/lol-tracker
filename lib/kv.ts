// Upstash Redis(REST 기반 무료 KV 스토어)에 데이터를 저장하기 위한 아주 얇은 래퍼입니다.
// 서버(API Route, 스크립트)에서만 사용하세요.

function config() {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    throw new Error('UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN 환경변수가 설정되지 않았습니다.');
  }
  // URL과 토큰을 바꿔 넣으면 fetch 오류 메시지에 토큰이 그대로 찍히므로, 값은 출력하지 않고 먼저 막습니다.
  if (!url.startsWith('https://')) {
    throw new Error('UPSTASH_REDIS_REST_URL은 https:// 로 시작해야 합니다. URL과 TOKEN이 서로 바뀌지 않았는지 확인하세요.');
  }
  return { url, token };
}

export async function kvGet<T>(key: string): Promise<T | null> {
  const { url, token } = config();
  const res = await fetch(`${url}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Upstash GET 실패 (${res.status})`);
  const json = await res.json();
  return json.result ? (JSON.parse(json.result) as T) : null;
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  const { url, token } = config();
  const res = await fetch(`${url}/set/${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(value),
  });
  if (!res.ok) throw new Error(`Upstash SET 실패 (${res.status})`);
}

// 임의의 Redis 명령 하나를 실행합니다. 예: kvCommand(['INCRBY', 'key', 1])
export async function kvCommand<T = unknown>(args: (string | number)[]): Promise<T> {
  const { url, token } = config();
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(args),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Upstash 명령 실패 (${res.status})`);
  const json = await res.json();
  if (json.error) throw new Error(`Upstash 오류: ${json.error}`);
  return json.result as T;
}

// 여러 명령을 HTTP 요청 한 번으로 실행합니다. (Upstash 요금은 명령마다 따로 계산됩니다)
export async function kvPipeline(cmds: (string | number)[][]): Promise<unknown[]> {
  const { url, token } = config();
  const res = await fetch(`${url}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(cmds),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Upstash 파이프라인 실패 (${res.status})`);
  const items = (await res.json()) as { result?: unknown; error?: string }[];
  const failed = items.find((item) => item.error);
  if (failed) throw new Error(`Upstash 오류: ${failed.error}`);
  return items.map((item) => item.result ?? null);
}
