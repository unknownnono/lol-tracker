// 수집 API 공통: 수집 키 확인, IP별 분당 요청 제한
import { timingSafeEqual } from 'node:crypto';
import type { NextApiRequest } from 'next';
import { upstash } from './redis';

export function keyMatches(given: unknown, expected: string): boolean {
  if (typeof given !== 'string') return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

// 키가 앱 안에 들어 있어 빼낼 수 있으므로, IP별로 1분에 limit번까지만 받습니다 (Upstash 명령 2개).
export async function overIpLimit(req: NextApiRequest, name: string, limit: number): Promise<boolean> {
  const forwarded = req.headers['x-forwarded-for'];
  const ip = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0].trim() || req.socket?.remoteAddress || 'unknown';
  const key = `rl:${name}:${ip}:${Math.floor(Date.now() / 60_000)}`;
  const [count] = await upstash.pipe([['INCR', key], ['EXPIRE', key, 70]]);
  return Number(count) > limit;
}
