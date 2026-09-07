import type { NextApiRequest, NextApiResponse } from 'next';
import { kvGet, kvSet } from '@/lib/kv';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method === 'GET') {
      const { code } = req.query;
      if (typeof code !== 'string' || !code) {
        return res.status(400).json({ error: '코드가 필요합니다.' });
      }
      const data = await kvGet(`lol-tracker-sync:${code}`);
      return res.status(200).json({ data });
    }

    if (req.method === 'POST') {
      const { code, data } = req.body || {};
      if (typeof code !== 'string' || !code) {
        return res.status(400).json({ error: '코드가 필요합니다.' });
      }
      await kvSet(`lol-tracker-sync:${code}`, data);
      return res.status(200).json({ ok: true });
    }

    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).json({ error: '허용되지 않는 메서드입니다.' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: '동기화 서버 오류가 발생했습니다. Upstash 환경변수가 설정되어 있는지 확인해주세요.' });
  }
}
