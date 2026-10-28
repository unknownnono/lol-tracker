// 이 PC 롤 클라이언트의 내 최근 Mayhem 경기를 수집 API로 보냅니다 (읽기 전용 LCU GET, 요청 사이 2초 간격).
// 사용법: npm run push:lcu -- [--api=https://lol.dec03.kr] [--count=20]
import { lcuGameToIngest } from '@/lib/aram/lcu';
import type { IngestGame } from '@/lib/aram/types';
import { lcuGet, readLcuCredentials } from './lcu-util';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const args = process.argv.slice(2);
  const api = args.find((a) => a.startsWith('--api='))?.split('=')[1] ?? 'https://lol.dec03.kr';
  const count = Math.min(Number(args.find((a) => a.startsWith('--count='))?.split('=')[1] ?? 20), 20);
  const key = process.env.INGEST_KEY;
  if (!key) throw new Error('INGEST_KEY가 없습니다. .env.local을 확인하세요.');

  const creds = readLcuCredentials();
  const hist = await lcuGet<any>(creds, `/lol-match-history/v1/products/lol/current-summoner/matches?begIndex=0&endIndex=${count - 1}`); // endIndex는 끝 번호 포함
  const ids: number[] = (hist.games?.games ?? []).filter((g: any) => g.queueId === 2400).map((g: any) => g.gameId);
  console.log(`최근 ${count}판 중 Mayhem ${ids.length}판`);

  const games: IngestGame[] = [];
  for (const id of ids) {
    await sleep(2000);
    const g = lcuGameToIngest(await lcuGet<any>(creds, `/lol-match-history/v1/games/${id}`));
    if (g) games.push(g);
  }
  if (games.length === 0) return console.log('보낼 경기가 없습니다.');

  for (let i = 0; i < games.length; i += 20) {
    const res = await fetch(`${api}/api/aram/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Ingest-Key': key },
      body: JSON.stringify({ games: games.slice(i, i + 20) }),
    });
    console.log(`전송 결과: HTTP ${res.status}`, await res.json());
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
