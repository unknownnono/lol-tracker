// Upstash Redis(REST 기반 무료 KV 스토어)에 즐겨찾기/최근검색 데이터를 저장하기 위한 아주 얇은 래퍼입니다.
// 서버(API Route)에서만 사용하세요.

const KV_URL = process.env.UPSTASH_REDIS_REST_URL;
const KV_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

function assertConfigured() {
  if (!KV_URL || !KV_TOKEN) {
    throw new Error('UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN 환경변수가 설정되지 않았습니다.');
  }
}

export async function kvGet<T>(key: string): Promise<T | null> {
  assertConfigured();
  const res = await fetch(`${KV_URL}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${KV_TOKEN}` },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Upstash GET 실패 (${res.status})`);
  const json = await res.json();
  return json.result ? (JSON.parse(json.result) as T) : null;
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  assertConfigured();
  const res = await fetch(`${KV_URL}/set/${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_TOKEN}` },
    body: JSON.stringify(value),
  });
  if (!res.ok) throw new Error(`Upstash SET 실패 (${res.status})`);
}
