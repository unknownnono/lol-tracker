// 일반 칼바람(450) 경기 타임라인을 Riot API로 모아 챔피언별 스킬 순서를 쌓습니다 (아수라장은 Riot API가 막아서 대신 씀).
// 랭크 유저 몇 명에서 시작해, 읽은 경기의 다른 참가자로 넓혀 갑니다. 이미 읽은 경기는 로컬 파일로 기억합니다.
// 사용법: npm run collect:skills -- [--max=300]   (Ctrl+C로 멈추면 모은 데까지 저장)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isRecentPatch, patchOf } from '@/lib/aram/aggregate';
import { Pacer } from '@/lib/aram/pacer';
import { upstash } from '@/lib/aram/redis';
import { SKILL_PATCH_WINDOW, applySkillSamples, mergeSkillAggs, pruneSkillAgg, skillSamples, type SkillAgg } from '@/lib/aram/skills';
import { loadAggs, saveAggs } from '@/lib/aram/store';
import { RiotApiError, getLatestDdragonVersion, riotRequest } from '@/lib/riot';

const KR = 'https://kr.api.riotgames.com';
const ASIA = 'https://asia.api.riotgames.com';
const SEED_TIERS = ['GOLD/I', 'PLATINUM/II', 'EMERALD/III', 'SILVER/I'];
const FLUSH_EVERY = 25;
const QUEUE_MAX = 5000;
const CACHE_DIR = join(process.cwd(), 'scripts', '.cache');
const SEEN_FILE = join(CACHE_DIR, 'skill-seen.json');
const SEEN_MAX = 50_000;
const RECENT_DAYS = 180; // 12패치 ≈ 반년: 경기 목록부터 이 기간만 받아 오래된 경기를 열어 보는 요청을 아낌

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const pacer = new Pacer();

async function riot<T>(url: string): Promise<T | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    let wait: number;
    while ((wait = pacer.waitMs(Date.now())) > 0) await sleep(wait);
    pacer.record(Date.now());
    try {
      return await riotRequest<T>(url);
    } catch (err) {
      if (err instanceof RiotApiError && err.status === 404) return null;
      if (err instanceof RiotApiError && err.status === 429) {
        console.log('  요청 한도 → 30초 쉼');
        await sleep(30_000);
        continue;
      }
      if (err instanceof RiotApiError && err.status === 403) throw err; // 키 만료: 멈춤
      await sleep(3000);
    }
  }
  return null;
}

function loadSeen(): Set<string> {
  try {
    return new Set(JSON.parse(readFileSync(SEEN_FILE, 'utf8')) as string[]);
  } catch {
    return new Set();
  }
}

function saveSeen(seen: Set<string>) {
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(SEEN_FILE, JSON.stringify([...seen].slice(-SEEN_MAX)));
}

// 모은 증분을 Redis 누적값에 더합니다 (MGET 1번 + MSET 1번).
async function flush(delta: Map<string, SkillAgg>) {
  if (delta.size === 0) return;
  const keys = [...delta.keys()];
  const current = (await loadAggs(upstash, keys)) as unknown as Map<string, SkillAgg>;
  const merged = new Map<string, SkillAgg>();
  for (const k of keys) {
    const m = current.has(k) ? mergeSkillAggs(current.get(k)!, delta.get(k)!) : delta.get(k)!;
    pruneSkillAgg(m);
    merged.set(k, m);
  }
  await saveAggs(upstash, merged as never);
  delta.clear();
}

async function main() {
  const max = Number(process.argv.find((a) => a.startsWith('--max='))?.split('=')[1] ?? 300);
  const latest = patchOf(await getLatestDdragonVersion());
  const seen = loadSeen();
  const delta = new Map<string, SkillAgg>();
  const queue: string[] = [];
  const queued = new Set<string>();
  const enqueue = (p: string) => {
    if (queue.length < QUEUE_MAX && !queued.has(p)) {
      queued.add(p);
      queue.push(p);
    }
  };

  let done = 0;
  let stopping = false;
  process.on('SIGINT', () => {
    if (stopping) process.exit(1);
    stopping = true;
    console.log('\n멈추는 중… 모은 데까지 저장합니다.');
  });

  for (const t of SEED_TIERS) {
    const entries = await riot<{ puuid?: string }[]>(`${KR}/lol/league/v4/entries/RANKED_SOLO_5x5/${t}?page=1`);
    for (const e of (entries ?? []).slice(0, 25)) if (e.puuid) enqueue(e.puuid);
  }
  console.log(`최신 패치 ${latest}, 시작 유저 ${queue.length}명, 목표 ${max}판`);

  while (!stopping && done < max && queue.length > 0) {
    const puuid = queue.shift()!;
    const since = Math.floor(Date.now() / 1000) - RECENT_DAYS * 86400;
    const ids = (await riot<string[]>(`${ASIA}/lol/match/v5/matches/by-puuid/${puuid}/ids?queue=450&startTime=${since}&start=0&count=5`)) ?? [];
    for (const id of ids) {
      if (stopping || done >= max) break;
      if (seen.has(id)) continue;
      seen.add(id);
      const match = await riot<any>(`${ASIA}/lol/match/v5/matches/${id}`);
      if (!match?.info) continue;
      for (const p of match.metadata?.participants ?? []) if (p !== puuid) enqueue(p);
      const patch = patchOf(String(match.info.gameVersion ?? ''));
      if (!isRecentPatch(patch, latest, SKILL_PATCH_WINDOW)) continue;
      const timeline = await riot<any>(`${ASIA}/lol/match/v5/matches/${id}/timeline`);
      const samples = skillSamples(match, timeline);
      if (samples.length === 0) continue;
      applySkillSamples(delta, samples);
      done += 1;
      if (done % FLUSH_EVERY === 0) {
        await flush(delta);
        saveSeen(seen);
        console.log(`${done}판 저장 (대기 유저 ${queue.length}명)`);
      }
    }
  }
  await flush(delta);
  saveSeen(seen);
  console.log(`끝: ${done}판`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
