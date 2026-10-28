// Riot API 전역 호출 한도기 (전적 검색용). 여러 Vercel 인스턴스가 Upstash 카운터를 공유합니다.
// 개인용 키 한도는 1초 20회, 2분 100회입니다.
// - 2분 한도: 슬라이딩 창 근사(현재 창 + 직전 창 × 남은 비율)로 90회. 창 경계에 몰리는 폭주를 막습니다.
// - 초당 한도: 16회.
import type { Cmd, RedisLike } from '@/lib/aram/redis';

export const LIMITS = { searchPerSecond: 16, perTwoMinutes: 90 } as const;
export const BLOCK_KEY = 'rl:block';

const WINDOW_MS = 120_000;
const WINDOW_TTL_SEC = 250; // 다음 창에서 직전 창 값을 읽을 수 있도록 두 창 이상 보관

export function windowKeys(nowMs: number) {
  const sec = Math.floor(nowMs / 1000);
  const win = Math.floor(nowMs / WINDOW_MS);
  return {
    sec: `rl:1s:${sec}`,
    win: `rl:120s:${win}`,
    prevWin: `rl:120s:${win - 1}`,
    frac: (nowMs % WINDOW_MS) / WINDOW_MS,
  };
}

export function decide(c: { sec: number; win: number; blocked: boolean }): boolean {
  if (c.blocked) return false;
  if (c.sec > LIMITS.searchPerSecond) return false;
  if (c.win > LIMITS.perTwoMinutes) return false;
  return true;
}

// n회 호출할 권한을 한 번에 예약합니다. 거부되면 올린 카운터를 되돌립니다.
export async function acquire(redis: RedisLike, n = 1, nowMs = Date.now()): Promise<boolean> {
  const k = windowKeys(nowMs);
  const cmds: Cmd[] = [
    ['INCRBY', k.sec, n],
    ['EXPIRE', k.sec, 2],
    ['INCRBY', k.win, n],
    ['EXPIRE', k.win, WINDOW_TTL_SEC],
    ['GET', k.prevWin],
    ['GET', BLOCK_KEY],
  ];

  let out: unknown[];
  try {
    out = await redis.pipe(cmds);
  } catch (err) {
    // Upstash가 없거나 장애일 때는 전적 검색이 예전처럼 동작하도록 허용합니다.
    console.warn('[rateLimit] Redis를 쓸 수 없어 한도 확인을 건너뜁니다.', err);
    return true;
  }

  const counts = {
    sec: Number(out[0]),
    win: Number(out[2]) + Number(out[4] ?? 0) * (1 - k.frac),
    blocked: out[5] != null,
  };
  if (decide(counts)) return true;

  await redis.pipe([['DECRBY', k.sec, n], ['DECRBY', k.win, n]]).catch(() => {});
  return false;
}

// Riot이 429를 돌려줬을 때 Retry-After 동안 모든 호출을 막습니다.
export async function blockFor(redis: RedisLike, seconds: number): Promise<void> {
  const s = Math.max(1, Math.ceil(seconds));
  await redis.cmd(['SET', BLOCK_KEY, '1', 'EX', s]);
}
