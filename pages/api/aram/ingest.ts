import { timingSafeEqual } from 'node:crypto';
import type { NextApiRequest, NextApiResponse } from 'next';
import { patchOf } from '@/lib/aram/aggregate';
import { ingestGames, parseIngestRequest } from '@/lib/aram/ingest';
import { getItemClasses } from '@/lib/aram/items';
import { upstash } from '@/lib/aram/redis';
import { getLatestDdragonVersion } from '@/lib/riot';

export const config = { api: { bodyParser: { sizeLimit: '200kb' } } };

const PER_IP_PER_MINUTE = 10;

// 키가 앱 안에 들어 있어 빼낼 수 있으므로, IP별로 1분에 10번까지만 받습니다 (Upstash 명령 2개).
async function overIpLimit(req: NextApiRequest): Promise<boolean> {
  const forwarded = req.headers['x-forwarded-for'];
  const ip = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0].trim() || req.socket?.remoteAddress || 'unknown';
  const key = `rl:ingest:${ip}:${Math.floor(Date.now() / 60_000)}`;
  const [count] = await upstash.pipe([['INCR', key], ['EXPIRE', key, 70]]);
  return Number(count) > PER_IP_PER_MINUTE;
}

function keyMatches(given: unknown, expected: string): boolean {
  if (typeof given !== 'string') return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: '허용되지 않는 메서드입니다.' });
  }

  const serverKey = process.env.INGEST_KEY;
  if (!serverKey) {
    return res.status(503).json({ error: '수집 기능이 설정되지 않았습니다.' });
  }
  if (!keyMatches(req.headers['x-ingest-key'], serverKey)) {
    return res.status(401).json({ error: '인증에 실패했습니다.' });
  }

  const parsed = parseIngestRequest(req.body);
  if (!parsed) {
    return res.status(400).json({ error: '잘못된 요청입니다. games는 1~20개의 경기 배열이어야 합니다.' });
  }

  try {
    if (await overIpLimit(req)) {
      return res.status(429).json({ error: '요청이 너무 많습니다. 잠시 후 다시 보내세요.', retryAfter: 60 });
    }
    const version = await getLatestDdragonVersion();
    const classes = await getItemClasses(version);
    const result = await ingestGames(upstash, patchOf(version), parsed.games, classes);
    if (result === 'locked') {
      return res.status(503).json({ error: '다른 요청을 처리 중입니다. 잠시 후 다시 보내세요.', retryAfter: 5 });
    }
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json(result);
  } catch (err) {
    console.error('[ingest]', err);
    return res.status(503).json({ error: '통계 저장소에 연결할 수 없습니다. 잠시 후 다시 보내세요.' });
  }
}
