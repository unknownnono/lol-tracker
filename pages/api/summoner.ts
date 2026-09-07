import type { NextApiRequest, NextApiResponse } from 'next';
import { getFullSummonerProfile, RiotApiError, PLATFORMS, Platform } from '@/lib/riot';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { gameName, tagLine, platform } = req.query;

  if (
    typeof gameName !== 'string' ||
    typeof tagLine !== 'string' ||
    typeof platform !== 'string' ||
    !PLATFORMS.includes(platform as Platform)
  ) {
    return res.status(400).json({ error: '잘못된 요청입니다. gameName, tagLine, platform을 확인하세요.' });
  }

  try {
    const profile = await getFullSummonerProfile(gameName, tagLine, platform as Platform);
    return res.status(200).json(profile);
  } catch (err) {
    if (err instanceof RiotApiError) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error(err);
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
}
