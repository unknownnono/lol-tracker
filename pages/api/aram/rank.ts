import type { NextApiRequest, NextApiResponse } from 'next';
import { keyMatches, overIpLimit } from '@/lib/aram/ingestAuth';
import { getLeagueEntries, RiotApiError } from '@/lib/riot';

// GET /api/aram/rank?puuid=... — 한국 서버 랭크(솔로·자유)의 정확한 승·패 (수집 키 필요)
// 롤 클라이언트는 다른 사람의 패배 수를 0으로만 줘서, 증강픽 앱이 Riot API로 다시 물어봄
const PUUID = /^[A-Za-z0-9_-]{40,100}$/;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: '허용되지 않는 메서드입니다.' });
  }
  const serverKey = process.env.INGEST_KEY;
  if (!serverKey) return res.status(503).json({ error: '수집 기능이 설정되지 않았습니다.' });
  if (!keyMatches(req.headers['x-ingest-key'], serverKey)) return res.status(401).json({ error: '인증에 실패했습니다.' });
  const puuid = req.query.puuid;
  const unknownParam = Object.keys(req.query).some((k) => k !== 'puuid');
  if (unknownParam || typeof puuid !== 'string' || !PUUID.test(puuid)) return res.status(400).json({ error: '잘못된 요청입니다. puuid를 확인하세요.' });

  try {
    if (await overIpLimit(req, 'rank', 30)) return res.status(429).json({ error: '요청이 너무 많습니다. 잠시 후 다시 시도하세요.', retryAfter: 60 });
    const entries = await getLeagueEntries(puuid, 'kr');
    const pick = (q: string) => {
      const e = entries.find((x) => x.queueType === q);
      return e ? { tier: e.tier, division: e.rank, lp: e.leaguePoints, wins: e.wins, losses: e.losses } : null;
    };
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ solo: pick('RANKED_SOLO_5x5'), flex: pick('RANKED_FLEX_SR') });
  } catch (err) {
    if (err instanceof RiotApiError) return res.status(err.status === 404 ? 404 : 503).json({ error: err.message });
    console.error(err);
    return res.status(503).json({ error: '랭크 정보를 받지 못했습니다. 잠시 후 다시 시도하세요.' });
  }
}
