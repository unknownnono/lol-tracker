import type { NextApiRequest, NextApiResponse } from 'next';
import { keyMatches, overIpLimit } from '@/lib/aram/ingestAuth';
import { getAccountByRiotId, getChampionMastery, getLeagueEntries, RiotApiError } from '@/lib/riot';

// GET /api/aram/rank?gameName=..&tagLine=..[&champion=103] — 한국 서버 랭크(솔로·자유)의 정확한 승·패 (수집 키 필요)
// champion을 주면 그 챔피언 숙련도도 (안 해 봤으면 level 0)
// 롤 클라이언트는 다른 사람의 패배 수를 0으로만 줘서, 증강픽 앱이 Riot API로 다시 물어봄.
// (클라이언트의 puuid는 36자 형식이라 Riot API에 못 써서 닉네임#태그로 계정을 찾음)

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: '허용되지 않는 메서드입니다.' });
  }
  const serverKey = process.env.INGEST_KEY;
  if (!serverKey) return res.status(503).json({ error: '수집 기능이 설정되지 않았습니다.' });
  if (!keyMatches(req.headers['x-ingest-key'], serverKey)) return res.status(401).json({ error: '인증에 실패했습니다.' });
  const { gameName, tagLine, champion } = req.query;
  const unknownParam = Object.keys(req.query).some((k) => k !== 'gameName' && k !== 'tagLine' && k !== 'champion');
  const championId = champion === undefined ? null : Number(champion);
  if (championId !== null && !(Number.isInteger(championId) && championId > 0 && championId < 10_000)) return res.status(400).json({ error: '잘못된 요청입니다. champion을 확인하세요.' });
  const ok = (v: unknown, max: number): v is string => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
  if (unknownParam || !ok(gameName, 32) || !ok(tagLine, 8)) return res.status(400).json({ error: '잘못된 요청입니다. gameName, tagLine을 확인하세요.' });

  try {
    if (await overIpLimit(req, 'rank', 30)) return res.status(429).json({ error: '요청이 너무 많습니다. 잠시 후 다시 시도하세요.', retryAfter: 60 });
    const account = await getAccountByRiotId(gameName.trim(), tagLine.trim(), 'kr');
    const [entries, mastery] = await Promise.all([
      getLeagueEntries(account.puuid, 'kr'),
      championId === null ? Promise.resolve(undefined) : getChampionMastery(account.puuid, championId, 'kr'),
    ]);
    const pick = (q: string) => {
      const e = entries.find((x) => x.queueType === q);
      return e ? { tier: e.tier, division: e.rank, lp: e.leaguePoints, wins: e.wins, losses: e.losses } : null;
    };
    res.setHeader('Cache-Control', 'no-store');
    const masteryOut = mastery === undefined ? {} : { mastery: { level: mastery?.championLevel ?? 0, points: mastery?.championPoints ?? 0 } };
    return res.status(200).json({ solo: pick('RANKED_SOLO_5x5'), flex: pick('RANKED_FLEX_SR'), ...masteryOut });
  } catch (err) {
    if (err instanceof RiotApiError) return res.status(err.status === 404 ? 404 : 503).json({ error: err.message });
    console.error(err);
    return res.status(503).json({ error: '랭크 정보를 받지 못했습니다. 잠시 후 다시 시도하세요.' });
  }
}
