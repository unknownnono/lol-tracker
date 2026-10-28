import type { NextApiRequest, NextApiResponse } from 'next';
import { getAramBuild } from '@/lib/aram/service';
import type { Queue } from '@/lib/aram/aggregate';

const QUEUES: readonly Queue[] = [450, 2400];
const ALLOWED_PARAMS = new Set(['champion', 'queue']);
const MAX_CHAMPION_ID = 10_000;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: '허용되지 않는 메서드입니다.' });
  }

  const championId = Number(req.query.champion);
  const queue = Number(req.query.queue) as Queue;
  const unknownParam = Object.keys(req.query).some((k) => !ALLOWED_PARAMS.has(k));
  if (unknownParam || !Number.isInteger(championId) || championId <= 0 || championId > MAX_CHAMPION_ID || !QUEUES.includes(queue)) {
    return res.status(400).json({ error: '잘못된 요청입니다. champion(챔피언 ID)과 queue(450 또는 2400)를 확인하세요.' });
  }

  try {
    const build = await getAramBuild(championId, queue);
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    return res.status(200).json(build);
  } catch (err) {
    console.error(err);
    return res.status(503).json({ error: '통계 저장소에 연결할 수 없습니다. 잠시 후 다시 시도하세요.' });
  }
}
