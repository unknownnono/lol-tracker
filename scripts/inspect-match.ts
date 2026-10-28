// 데이터 검증 스파이크: 실제 KR 칼바람(450)·Mayhem(2400) 경기 JSON에 룬/증강 필드가 있는지 확인하고
// 개인 식별 정보를 가명 처리해 테스트 픽스처로 저장합니다.
// 사용법: npx tsx --env-file=.env.local scripts/inspect-match.ts "이름#태그"
import { writeFileSync, mkdirSync } from 'node:fs';

const ASIA = 'https://asia.api.riotgames.com';
const key = process.env.RIOT_API_KEY;
if (!key) throw new Error('RIOT_API_KEY가 없습니다. .env.local을 확인하세요.');

async function riot<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { 'X-Riot-Token': key! } });
  if (!res.ok) throw new Error(`Riot API ${res.status}: ${url.replace(/by-riot-id\/.*/, 'by-riot-id/...')}`);
  return (await res.json()) as T;
}

function pseudonymize(match: any) {
  const map = new Map<string, string>();
  match.metadata.participants = match.metadata.participants.map((p: string, i: number) => {
    map.set(p, `puuid-${i}`);
    return `puuid-${i}`;
  });
  match.info.participants.forEach((p: any, i: number) => {
    p.puuid = map.get(p.puuid) ?? `puuid-${i}`;
    for (const f of ['riotIdGameName', 'summonerName']) if (f in p) p[f] = `player${i}`;
    for (const f of ['riotIdTagline']) if (f in p) p[f] = 'KR1';
    for (const f of ['summonerId']) if (f in p) p[f] = `summoner-${i}`;
  });
  return match;
}

async function main() {
  const riotId = process.argv[2];
  if (!riotId || !riotId.includes('#')) throw new Error('사용법: scripts/inspect-match.ts "이름#태그"');
  const [name, tag] = riotId.split('#');
  const account = await riot<{ puuid: string }>(
    `${ASIA}/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(name)}/${encodeURIComponent(tag)}`,
  );
  mkdirSync('test/fixtures', { recursive: true });

  for (const queue of [450, 2400]) {
    const ids = await riot<string[]>(`${ASIA}/lol/match/v5/matches/by-puuid/${account.puuid}/ids?queue=${queue}&start=0&count=5`);
    if (ids.length === 0) {
      console.log(`[${queue}] 최근 경기 없음 — 이 큐로 한 판 이상 플레이한 계정으로 다시 실행하세요.`);
      continue;
    }
    const match = await riot<any>(`${ASIA}/lol/match/v5/matches/${ids[0]}`);
    const p = match.info.participants[0];
    const interesting = Object.keys(p).filter((k) => /perk|ugment|rune/i.test(k));
    console.log(`[${queue}] ${ids[0]} gameVersion=${match.info.gameVersion} gameDuration=${match.info.gameDuration}`);
    console.log(`  관련 필드: ${interesting.join(', ') || '(없음)'}`);
    console.log(`  perks.styles 개수: ${p.perks?.styles?.length ?? '없음'}, statPerks: ${JSON.stringify(p.perks?.statPerks ?? null)}`);
    for (const k of Object.keys(p).filter((k) => /ugment/i.test(k))) console.log(`  ${k} = ${JSON.stringify(p[k])}`);
    writeFileSync(`test/fixtures/match-${queue}.json`, JSON.stringify(pseudonymize(match), null, 2));
    console.log(`  저장: test/fixtures/match-${queue}.json`);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
