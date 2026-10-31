import type { NextApiRequest, NextApiResponse } from 'next';
import { patchOf } from '@/lib/aram/aggregate';
import { ingestComboSamples, parseComboRequest } from '@/lib/aram/comboIngest';
import { keyMatches, overIpLimit } from '@/lib/aram/ingestAuth';
import { upstash } from '@/lib/aram/redis';
import { getLatestDdragonVersion } from '@/lib/riot';

export const config = { api: { bodyParser: { sizeLimit: '100kb' } } };

// POST /api/aram/combo-ingest — 전적 목록에서 뽑은 '한 사람 한 판 증강·승패'로 증강 조합만 쌓음 (수집 키 필요)
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: '허용되지 않는 메서드입니다.' });
  }
  const serverKey = process.env.INGEST_KEY;
  if (!serverKey) return res.status(503).json({ error: '수집 기능이 설정되지 않았습니다.' });
  if (!keyMatches(req.headers['x-ingest-key'], serverKey)) return res.status(401).json({ error: '인증에 실패했습니다.' });

  const parsed = parseComboRequest(req.body);
  if (!parsed) return res.status(400).json({ error: '잘못된 요청입니다. samples는 1~200개의 배열이어야 합니다.' });

  try {
    if (await overIpLimit(req, 'combo', 10)) {
      return res.status(429).json({ error: '요청이 너무 많습니다. 잠시 후 다시 보내세요.', retryAfter: 60 });
    }
    const version = await getLatestDdragonVersion();
    const result = await ingestComboSamples(upstash, patchOf(version), parsed.samples);
    if (result === 'locked') return res.status(503).json({ error: '다른 요청을 처리 중입니다. 잠시 후 다시 보내세요.', retryAfter: 5 });
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json(result);
  } catch (err) {
    console.error('[combo-ingest]', err);
    return res.status(503).json({ error: '통계 저장소에 연결할 수 없습니다. 잠시 후 다시 보내세요.' });
  }
}
