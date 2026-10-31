import type { NextApiRequest, NextApiResponse } from 'next';
import { getChampionTiers } from '@/lib/aram/champions';
import { getChampionIdNameMap, getLatestDdragonVersion } from '@/lib/riot';

// GET /api/aram/champions?queue=2400 — 아수라장 챔피언 티어표 (최신·직전 패치)
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: '허용되지 않는 메서드입니다.' });
  }
  const unknownParam = Object.keys(req.query).some((k) => k !== 'queue');
  if (unknownParam || req.query.queue !== '2400') {
    return res.status(400).json({ error: '잘못된 요청입니다. queue=2400만 지원합니다.' });
  }
  try {
    const ids = Object.keys(await getChampionIdNameMap(await getLatestDdragonVersion())).map(Number);
    const tiers = await getChampionTiers(ids, 2400);
    res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=1200');
    return res.status(200).json(tiers);
  } catch (err) {
    console.error(err);
    return res.status(503).json({ error: '통계 저장소에 연결할 수 없습니다. 잠시 후 다시 시도하세요.' });
  }
}
